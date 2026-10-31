package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func testPayload(version string) Payload {
	return Payload{Version: version, Files: map[string][]byte{
		"main.js":       []byte("module.exports = {}"),
		"manifest.json": []byte(`{"id":"archivarious","version":"` + version + `"}`),
		"styles.css":    []byte(".a{}"),
	}}
}

func mkVault(t *testing.T, root, name string) string {
	t.Helper()
	p := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Join(p, ".obsidian"), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func readIDs(t *testing.T, vault string) []string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(vault, ".obsidian", "community-plugins.json"))
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	if err := json.Unmarshal(b, &ids); err != nil {
		t.Fatal(err)
	}
	return ids
}

func TestFindVaults(t *testing.T) {
	root := t.TempDir()
	work := mkVault(t, root, "Работа")
	notes := mkVault(t, root, "Notes")
	old := mkVault(t, root, "Old")
	cfg := filepath.Join(root, "obsidian.json")
	raw := map[string]any{"vaults": map[string]any{
		"a": map[string]any{"path": old, "ts": 100},
		"b": map[string]any{"path": notes, "ts": 300},
		"c": map[string]any{"path": work, "ts": 200, "open": true},
		"d": map[string]any{"path": filepath.Join(root, "deleted"), "ts": 999},
	}}
	b, _ := json.Marshal(raw)
	if err := os.WriteFile(cfg, b, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Install(notes, testPayload("0.1.0")); err != nil {
		t.Fatal(err)
	}

	got := FindVaults([]string{filepath.Join(root, "missing.json"), cfg, cfg})
	var names []string
	for _, v := range got {
		names = append(names, v.Name)
	}
	if want := []string{"Работа", "Notes", "Old"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("order = %v, want %v", names, want)
	}
	if got[1].InstalledVersion != "0.1.0" || got[0].InstalledVersion != "" {
		t.Fatalf("installed versions = %q, %q", got[0].InstalledVersion, got[1].InstalledVersion)
	}
}

func TestInstallFreshVault(t *testing.T) {
	vault := mkVault(t, t.TempDir(), "v")
	res, err := Install(vault, testPayload("0.4.0"))
	if err != nil {
		t.Fatal(err)
	}
	if res.PreviousVersion != "" || res.WasEnabled {
		t.Fatalf("unexpected result %+v", res)
	}
	for _, f := range pluginFiles {
		if _, err := os.Stat(filepath.Join(vault, ".obsidian", "plugins", "archivarious", f)); err != nil {
			t.Fatal(err)
		}
	}
	if ids := readIDs(t, vault); !reflect.DeepEqual(ids, []string{"archivarious"}) {
		t.Fatalf("ids = %v", ids)
	}
}

func TestUpgradeKeepsSettingsAndOtherPlugins(t *testing.T) {
	vault := mkVault(t, t.TempDir(), "v")
	list := filepath.Join(vault, ".obsidian", "community-plugins.json")
	if err := os.WriteFile(list, []byte("[\n  \"dataview\"\n]"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Install(vault, testPayload("0.3.0")); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(vault, ".obsidian", "plugins", "archivarious", "data.json")
	if err := os.WriteFile(data, []byte(`{"inbox":"X"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := Install(vault, testPayload("0.4.0"))
	if err != nil {
		t.Fatal(err)
	}
	if res.PreviousVersion != "0.3.0" || !res.WasEnabled {
		t.Fatalf("unexpected result %+v", res)
	}
	if InstalledVersion(vault) != "0.4.0" {
		t.Fatalf("version not updated")
	}
	if b, _ := os.ReadFile(data); string(b) != `{"inbox":"X"}` {
		t.Fatalf("data.json changed: %s", b)
	}
	if ids := readIDs(t, vault); !reflect.DeepEqual(ids, []string{"dataview", "archivarious"}) {
		t.Fatalf("ids = %v", ids)
	}
	entries, _ := os.ReadDir(filepath.Join(vault, ".obsidian", "plugins", "archivarious"))
	if len(entries) != 4 {
		t.Fatalf("leftover temp files: %v", entries)
	}
}

func TestBrokenPluginListIsBackedUp(t *testing.T) {
	vault := mkVault(t, t.TempDir(), "v")
	list := filepath.Join(vault, ".obsidian", "community-plugins.json")
	if err := os.WriteFile(list, []byte("{oops"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := Install(vault, testPayload("0.4.0"))
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(res.BackupPath); string(b) != "{oops" {
		t.Fatalf("backup = %q", b)
	}
	if ids := readIDs(t, vault); !reflect.DeepEqual(ids, []string{"archivarious"}) {
		t.Fatalf("ids = %v", ids)
	}
}

func TestInstallIntoPlainFolderCreatesObsidianDir(t *testing.T) {
	dir := t.TempDir()
	if LooksLikeVault(dir) {
		t.Fatal("plain folder looks like a vault")
	}
	if _, err := Install(dir, testPayload("0.4.0")); err != nil {
		t.Fatal(err)
	}
	if !LooksLikeVault(dir) {
		t.Fatal(".obsidian not created")
	}
}

func TestInstallMissingVault(t *testing.T) {
	if _, err := Install(filepath.Join(t.TempDir(), "nope"), testPayload("0.4.0")); err == nil {
		t.Fatal("expected error")
	}
}
