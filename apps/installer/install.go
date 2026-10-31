// Package main is the ArchiVarious plugin installer: it finds the user's Obsidian vaults, copies the plugin
// into <vault>/.obsidian/plugins/archivarious and enables it in community-plugins.json.
//
// This file holds the platform-independent logic; gui_windows.go is the Windows window, cli_other.go a
// console fallback for macOS/Linux.
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

const pluginID = "archivarious"

// pluginFiles are the files Obsidian loads for a plugin. data.json (the user's plugin settings) is never touched.
var pluginFiles = []string{"main.js", "manifest.json", "styles.css"}

//go:embed payload
var payloadFS embed.FS

// Payload is the plugin build embedded into the installer.
type Payload struct {
	Version string
	Files   map[string][]byte
}

func loadPayload() (Payload, error) {
	p := Payload{Files: map[string][]byte{}}
	for _, name := range pluginFiles {
		b, err := payloadFS.ReadFile("payload/" + name)
		if err != nil {
			return p, fmt.Errorf("в установщике нет файла %s: он собран неправильно", name)
		}
		p.Files[name] = b
	}
	v, err := manifestVersion(p.Files["manifest.json"])
	if err != nil {
		return p, err
	}
	p.Version = v
	return p, nil
}

func manifestVersion(b []byte) (string, error) {
	var m struct {
		ID      string `json:"id"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return "", fmt.Errorf("manifest.json: %w", err)
	}
	if m.ID != pluginID || m.Version == "" {
		return "", errors.New("manifest.json: это не манифест ArchiVarious")
	}
	return m.Version, nil
}

// Vault is one entry of Obsidian's vault list.
type Vault struct {
	Name string
	Path string
	// LastOpened is Obsidian's "ts" (ms since epoch); Open marks the vault that was open last.
	LastOpened int64
	Open       bool
	// InstalledVersion is the ArchiVarious version already in the vault, or "".
	InstalledVersion string
}

// obsidianConfigCandidates lists where Obsidian keeps obsidian.json (the list of known vaults) on this OS.
func obsidianConfigCandidates() []string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		var out []string
		if appData := os.Getenv("APPDATA"); appData != "" {
			out = append(out, filepath.Join(appData, "obsidian", "obsidian.json"))
		}
		if home != "" {
			out = append(out, filepath.Join(home, "AppData", "Roaming", "obsidian", "obsidian.json"))
		}
		return out
	case "darwin":
		return []string{filepath.Join(home, "Library", "Application Support", "obsidian", "obsidian.json")}
	default:
		cfg := os.Getenv("XDG_CONFIG_HOME")
		if cfg == "" {
			cfg = filepath.Join(home, ".config")
		}
		return []string{
			filepath.Join(cfg, "obsidian", "obsidian.json"),
			filepath.Join(home, ".var", "app", "md.obsidian.Obsidian", "config", "obsidian", "obsidian.json"),
			filepath.Join(home, "snap", "obsidian", "current", ".config", "obsidian", "obsidian.json"),
		}
	}
}

// FindVaults reads every existing config file and returns the vaults whose folders still exist,
// the last opened first. Missing or unreadable config files are skipped.
func FindVaults(configPaths []string) []Vault {
	seen := map[string]bool{}
	var vaults []Vault
	for _, cfg := range configPaths {
		b, err := os.ReadFile(cfg)
		if err != nil {
			continue
		}
		var parsed struct {
			Vaults map[string]struct {
				Path string `json:"path"`
				TS   int64  `json:"ts"`
				Open bool   `json:"open"`
			} `json:"vaults"`
		}
		if json.Unmarshal(b, &parsed) != nil {
			continue
		}
		for _, v := range parsed.Vaults {
			if v.Path == "" {
				continue
			}
			p := filepath.Clean(v.Path)
			key := strings.ToLower(p)
			if seen[key] || !isDir(p) {
				continue
			}
			seen[key] = true
			vaults = append(vaults, Vault{
				Name:             filepath.Base(p),
				Path:             p,
				LastOpened:       v.TS,
				Open:             v.Open,
				InstalledVersion: InstalledVersion(p),
			})
		}
	}
	sort.SliceStable(vaults, func(i, j int) bool {
		if vaults[i].Open != vaults[j].Open {
			return vaults[i].Open
		}
		if vaults[i].LastOpened != vaults[j].LastOpened {
			return vaults[i].LastOpened > vaults[j].LastOpened
		}
		return strings.ToLower(vaults[i].Name) < strings.ToLower(vaults[j].Name)
	})
	return vaults
}

// NewVault describes a folder the user picked by hand.
func NewVault(path string) Vault {
	p := filepath.Clean(path)
	return Vault{Name: filepath.Base(p), Path: p, InstalledVersion: InstalledVersion(p)}
}

// LooksLikeVault reports whether the folder has Obsidian's .obsidian config folder.
func LooksLikeVault(path string) bool {
	return isDir(filepath.Join(path, ".obsidian"))
}

func pluginDir(vault string) string {
	return filepath.Join(vault, ".obsidian", "plugins", pluginID)
}

// InstalledVersion returns the ArchiVarious version installed in the vault, or "".
func InstalledVersion(vault string) string {
	b, err := os.ReadFile(filepath.Join(pluginDir(vault), "manifest.json"))
	if err != nil {
		return ""
	}
	v, err := manifestVersion(b)
	if err != nil {
		return ""
	}
	return v
}

// Result describes what Install did.
type Result struct {
	PluginDir       string
	PreviousVersion string
	// WasEnabled is true when community-plugins.json already listed the plugin.
	WasEnabled bool
	// BackupPath is set when an unreadable community-plugins.json was moved aside.
	BackupPath string
}

// Install copies the plugin files into the vault and enables the plugin. It keeps data.json (the plugin's
// settings) and every other enabled plugin.
func Install(vault string, p Payload) (Result, error) {
	var res Result
	if !isDir(vault) {
		return res, fmt.Errorf("папка хранилища не найдена: %s", vault)
	}
	res.PluginDir = pluginDir(vault)
	res.PreviousVersion = InstalledVersion(vault)
	if err := os.MkdirAll(res.PluginDir, 0o755); err != nil {
		return res, fmt.Errorf("не удалось создать папку плагина: %w", err)
	}
	for _, name := range pluginFiles {
		data, ok := p.Files[name]
		if !ok {
			return res, fmt.Errorf("в установщике нет файла %s", name)
		}
		if err := writeFileAtomic(filepath.Join(res.PluginDir, name), data); err != nil {
			return res, fmt.Errorf("не удалось записать %s: %w", name, err)
		}
	}
	wasEnabled, backup, err := enablePlugin(filepath.Join(vault, ".obsidian", "community-plugins.json"))
	res.WasEnabled, res.BackupPath = wasEnabled, backup
	if err != nil {
		return res, fmt.Errorf("плагин скопирован, но не удалось его включить: %w", err)
	}
	return res, nil
}

// enablePlugin adds the plugin id to community-plugins.json (a JSON array of plugin ids), creating it if needed.
func enablePlugin(file string) (wasEnabled bool, backup string, err error) {
	var ids []string
	b, readErr := os.ReadFile(file)
	switch {
	case readErr == nil && len(strings.TrimSpace(string(b))) > 0:
		if json.Unmarshal(b, &ids) != nil {
			// Obsidian could not read this file either. Keep a copy and start a fresh list.
			backup = file + ".bak"
			if err := os.WriteFile(backup, b, 0o644); err != nil {
				return false, "", err
			}
			ids = nil
		}
	case readErr != nil && !errors.Is(readErr, os.ErrNotExist):
		return false, "", readErr
	}
	for _, id := range ids {
		if id == pluginID {
			return true, backup, nil
		}
	}
	ids = append(ids, pluginID)
	out, err := json.MarshalIndent(ids, "", "  ")
	if err != nil {
		return false, backup, err
	}
	return false, backup, writeFileAtomic(file, out)
}

func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	_, werr := tmp.Write(data)
	cerr := tmp.Close()
	if werr == nil {
		werr = cerr
	}
	if werr == nil {
		werr = os.Rename(tmpName, path)
	}
	if werr != nil {
		_ = os.Remove(tmpName)
	}
	return werr
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}
