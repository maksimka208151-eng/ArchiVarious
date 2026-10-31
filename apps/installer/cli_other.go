//go:build !windows

package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// version is set at build time; it labels the installer itself.
var version = "dev"

// main is a console fallback for macOS and Linux. Windows users get the window in gui_windows.go.
func main() {
	p, err := loadPayload()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Ошибка:", err)
		os.Exit(1)
	}
	fmt.Printf("Установка плагина ArchiVarious %s\n\n", p.Version)

	var vault string
	if len(os.Args) > 1 {
		vault = os.Args[1]
	} else {
		vault = chooseVault(FindVaults(obsidianConfigCandidates()))
	}
	if vault == "" {
		os.Exit(1)
	}
	res, err := Install(vault, p)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Ошибка:", err)
		os.Exit(1)
	}
	fmt.Printf("Готово: плагин установлен в %s и включён.\n", res.PluginDir)
	fmt.Println("Перезапустите Obsidian, чтобы плагин загрузился.")
}

func chooseVault(vaults []Vault) string {
	in := bufio.NewReader(os.Stdin)
	if len(vaults) == 0 {
		fmt.Print("Хранилища Obsidian не найдены. Введите путь к папке хранилища: ")
		line, _ := in.ReadString('\n')
		return strings.TrimSpace(line)
	}
	fmt.Println("Хранилища Obsidian:")
	for i, v := range vaults {
		extra := ""
		if v.InstalledVersion != "" {
			extra = " (установлен " + v.InstalledVersion + ")"
		}
		fmt.Printf("  %d. %s  %s%s\n", i+1, v.Name, v.Path, extra)
	}
	fmt.Print("Номер хранилища (Enter = 1): ")
	line, _ := in.ReadString('\n')
	line = strings.TrimSpace(line)
	if line == "" {
		return vaults[0].Path
	}
	n, err := strconv.Atoi(line)
	if err != nil || n < 1 || n > len(vaults) {
		fmt.Fprintln(os.Stderr, "Нет такого номера.")
		return ""
	}
	return vaults[n-1].Path
}
