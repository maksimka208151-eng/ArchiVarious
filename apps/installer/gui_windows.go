//go:build windows

package main

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unsafe"
)

// version is set at build time; it labels the installer itself.
var version = "dev"

// The window is plain Win32 through syscall so the installer is a single dependency-free exe.

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	ole32    = syscall.NewLazyDLL("ole32.dll")
	comctl32 = syscall.NewLazyDLL("comctl32.dll")

	procRegisterClassExW    = user32.NewProc("RegisterClassExW")
	procCreateWindowExW     = user32.NewProc("CreateWindowExW")
	procDefWindowProcW      = user32.NewProc("DefWindowProcW")
	procDestroyWindow       = user32.NewProc("DestroyWindow")
	procGetMessageW         = user32.NewProc("GetMessageW")
	procTranslateMessage    = user32.NewProc("TranslateMessage")
	procDispatchMessageW    = user32.NewProc("DispatchMessageW")
	procIsDialogMessageW    = user32.NewProc("IsDialogMessageW")
	procPostQuitMessage     = user32.NewProc("PostQuitMessage")
	procSendMessageW        = user32.NewProc("SendMessageW")
	procMessageBoxW         = user32.NewProc("MessageBoxW")
	procLoadCursorW         = user32.NewProc("LoadCursorW")
	procLoadImageW          = user32.NewProc("LoadImageW")
	procShowWindow          = user32.NewProc("ShowWindow")
	procUpdateWindow        = user32.NewProc("UpdateWindow")
	procSetWindowTextW      = user32.NewProc("SetWindowTextW")
	procSetFocus            = user32.NewProc("SetFocus")
	procGetSystemMetrics    = user32.NewProc("GetSystemMetrics")
	procAdjustWindowRectEx  = user32.NewProc("AdjustWindowRectEx")
	procGetDC               = user32.NewProc("GetDC")
	procReleaseDC           = user32.NewProc("ReleaseDC")
	procGetSysColorBrush    = user32.NewProc("GetSysColorBrush")
	procSetProcessDPIAware  = user32.NewProc("SetProcessDPIAware")
	procCreateFontW         = gdi32.NewProc("CreateFontW")
	procGetDeviceCaps       = gdi32.NewProc("GetDeviceCaps")
	procSetBkMode           = gdi32.NewProc("SetBkMode")
	procGetModuleHandleW    = kernel32.NewProc("GetModuleHandleW")
	procShellExecuteW       = shell32.NewProc("ShellExecuteW")
	procSHBrowseForFolderW  = shell32.NewProc("SHBrowseForFolderW")
	procSHGetPathFromIDList = shell32.NewProc("SHGetPathFromIDListW")
	procCoInitializeEx      = ole32.NewProc("CoInitializeEx")
	procCoTaskMemFree       = ole32.NewProc("CoTaskMemFree")
	procInitCommonControls  = comctl32.NewProc("InitCommonControlsEx")
)

const (
	wsCaption        = 0x00C00000
	wsSysMenu        = 0x00080000
	wsMinimizeBox    = 0x00020000
	wsChild          = 0x40000000
	wsVisible        = 0x10000000
	wsTabStop        = 0x00010000
	wsVScroll        = 0x00200000
	wsExClientEdge   = 0x00000200
	wsExControlParen = 0x00010000

	bsPushButton    = 0x0
	bsDefPushButton = 0x1
	ssNoPrefix      = 0x80
	lbsNotify       = 0x1
	lbsNoIntegral   = 0x100

	wmDestroy         = 0x0002
	wmClose           = 0x0010
	wmSetFont         = 0x0030
	wmCommand         = 0x0111
	wmCtlColorStatic  = 0x0138
	lbAddString       = 0x0180
	lbSetCurSel       = 0x0186
	lbGetCurSel       = 0x0188
	lbnSelChange      = 1
	lbnDblClk         = 2
	mbOK              = 0x0
	mbYesNo           = 0x4
	mbCancelTryCont   = 0x6
	mbIconError       = 0x10
	mbIconQuestion    = 0x20
	mbIconWarning     = 0x30
	mbIconInformation = 0x40
	idYes             = 6
	idCancelMB        = 2
	idTryAgain        = 10
	idContinue        = 11
	colorWindow       = 5
	logPixelsY        = 90
	smCxScreen        = 0
	smCyScreen        = 1
	smCxIcon          = 11
	smCyIcon          = 12
	smCxSmIcon        = 49
	smCySmIcon        = 50
	imageIcon         = 1
	swShowNormal      = 1

	// Control ids. 1 and 2 are IDOK/IDCANCEL, so Enter installs and Esc closes the window.
	idInstall = 1
	idCancel  = 2
	idBrowse  = 100
	idList    = 101
)

type wndClassEx struct {
	size       uint32
	style      uint32
	wndProc    uintptr
	clsExtra   int32
	wndExtra   int32
	instance   uintptr
	icon       uintptr
	cursor     uintptr
	background uintptr
	menuName   *uint16
	className  *uint16
	iconSm     uintptr
}

type msgT struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
	private uint32
}

type rect struct{ left, top, right, bottom int32 }

type browseInfo struct {
	owner       uintptr
	root        uintptr
	displayName *uint16
	title       *uint16
	flags       uint32
	callback    uintptr
	lParam      uintptr
	image       int32
}

type initCommonControlsEx struct{ size, icc uint32 }

func u16(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(strings.ReplaceAll(s, "\x00", ""))
	return p
}

func ptr(s string) uintptr { return uintptr(unsafe.Pointer(u16(s))) }

type app struct {
	hwnd, list, installBtn, hint uintptr
	font, titleFont              uintptr
	dpi                          int
	vaults                       []Vault
	payload                      Payload
}

var ui app

const windowTitle = "Установка ArchiVarious"

func init() { runtime.LockOSThread() }

func main() {
	p, err := loadPayload()
	if err != nil {
		messageBox(0, "Не получилось запустить установку.\n\n"+err.Error(), mbOK|mbIconError)
		os.Exit(1)
	}
	ui.payload = p
	ui.vaults = FindVaults(obsidianConfigCandidates())
	if err := ui.run(); err != nil {
		messageBox(0, "Не получилось открыть окно установки.\n\n"+err.Error(), mbOK|mbIconError)
		os.Exit(1)
	}
}

func (a *app) scale(v int) int { return v * a.dpi / 96 }

func (a *app) run() error {
	if procSetProcessDPIAware.Find() == nil {
		procSetProcessDPIAware.Call()
	}
	icc := initCommonControlsEx{size: uint32(unsafe.Sizeof(initCommonControlsEx{})), icc: 0x4000 | 0x1}
	procInitCommonControls.Call(uintptr(unsafe.Pointer(&icc)))
	procCoInitializeEx.Call(0, 2) // apartment-threaded, for the folder picker

	hdc, _, _ := procGetDC.Call(0)
	dpi, _, _ := procGetDeviceCaps.Call(hdc, logPixelsY)
	procReleaseDC.Call(0, hdc)
	a.dpi = int(dpi)
	if a.dpi <= 0 {
		a.dpi = 96
	}
	a.font = a.createFont(10, 400)
	a.titleFont = a.createFont(14, 600)

	inst, _, _ := procGetModuleHandleW.Call(0)
	cursor, _, _ := procLoadCursorW.Call(0, 32512) // IDC_ARROW
	bg, _, _ := procGetSysColorBrush.Call(colorWindow)
	iconBig := a.loadIcon(inst, smCxIcon, smCyIcon)
	iconSmall := a.loadIcon(inst, smCxSmIcon, smCySmIcon)
	className := u16("ArchiVariousInstaller")
	wc := wndClassEx{
		size:       uint32(unsafe.Sizeof(wndClassEx{})),
		wndProc:    syscall.NewCallback(wndProc),
		instance:   inst,
		icon:       iconBig,
		cursor:     cursor,
		background: bg,
		className:  className,
		iconSm:     iconSmall,
	}
	if r, _, err := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return fmt.Errorf("RegisterClassEx: %w", err)
	}

	const style = wsCaption | wsSysMenu | wsMinimizeBox
	const exStyle = wsExControlParen
	cw, ch := a.scale(580), a.scale(388)
	r := rect{0, 0, int32(cw), int32(ch)}
	procAdjustWindowRectEx.Call(uintptr(unsafe.Pointer(&r)), style, 0, exStyle)
	w, h := int(r.right-r.left), int(r.bottom-r.top)
	sw, _, _ := procGetSystemMetrics.Call(smCxScreen)
	sh, _, _ := procGetSystemMetrics.Call(smCyScreen)
	x, y := (int(sw)-w)/2, (int(sh)-h)/2
	hwnd, _, err := procCreateWindowExW.Call(exStyle, uintptr(unsafe.Pointer(className)), ptr(windowTitle), style,
		uintptr(x), uintptr(y), uintptr(w), uintptr(h), 0, 0, inst, 0)
	if hwnd == 0 {
		return fmt.Errorf("CreateWindowEx: %w", err)
	}
	a.hwnd = hwnd
	a.buildControls()

	procShowWindow.Call(hwnd, swShowNormal)
	procUpdateWindow.Call(hwnd)
	procSetFocus.Call(a.list)

	var m msgT
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			return nil
		}
		if d, _, _ := procIsDialogMessageW.Call(hwnd, uintptr(unsafe.Pointer(&m))); d != 0 {
			continue
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func (a *app) createFont(pt, weight int) uintptr {
	height := -(pt*a.dpi + 36) / 72
	f, _, _ := procCreateFontW.Call(uintptr(height), 0, 0, 0, uintptr(weight), 0, 0, 0,
		1 /* DEFAULT_CHARSET */, 0, 0, 5 /* CLEARTYPE_QUALITY */, 0, ptr("Segoe UI"))
	return f
}

func (a *app) loadIcon(inst uintptr, cxMetric, cyMetric uintptr) uintptr {
	cx, _, _ := procGetSystemMetrics.Call(cxMetric)
	cy, _, _ := procGetSystemMetrics.Call(cyMetric)
	h, _, _ := procLoadImageW.Call(inst, ptr("APP"), imageIcon, cx, cy, 0)
	return h
}

func (a *app) child(class, text string, style, exStyle uintptr, x, y, w, h, id int, font uintptr) uintptr {
	hwnd, _, _ := procCreateWindowExW.Call(exStyle, ptr(class), ptr(text), wsChild|wsVisible|style,
		uintptr(a.scale(x)), uintptr(a.scale(y)), uintptr(a.scale(w)), uintptr(a.scale(h)), a.hwnd, uintptr(id), 0, 0)
	procSendMessageW.Call(hwnd, wmSetFont, font, 1)
	return hwnd
}

func (a *app) buildControls() {
	a.child("STATIC", "Установка ArchiVarious "+a.payload.Version, ssNoPrefix, 0, 24, 18, 532, 32, 0, a.titleFont)
	a.child("STATIC", "Плагин будет скопирован в выбранное хранилище Obsidian и сразу включён. "+
		"Ваши заметки и настройки плагина не изменятся.", ssNoPrefix, 0, 24, 58, 532, 40, 0, a.font)

	label := "Выберите хранилище:"
	if len(a.vaults) == 0 {
		label = "Хранилища Obsidian не найдены. Нажмите «Другая папка…» и укажите папку хранилища."
	}
	a.hint = a.child("STATIC", label, ssNoPrefix, 0, 24, 108, 532, 22, 0, a.font)

	a.list = a.child("LISTBOX", "", wsTabStop|wsVScroll|lbsNotify|lbsNoIntegral, wsExClientEdge,
		24, 134, 532, 180, idList, a.font)
	for _, v := range a.vaults {
		a.addVaultItem(v)
	}
	if len(a.vaults) > 0 {
		procSendMessageW.Call(a.list, lbSetCurSel, 0, 0)
	}

	a.child("BUTTON", "Другая папка…", wsTabStop|bsPushButton, 0, 24, 334, 160, 34, idBrowse, a.font)
	a.installBtn = a.child("BUTTON", "Установить", wsTabStop|bsDefPushButton, 0, 316, 334, 120, 34, idInstall, a.font)
	a.child("BUTTON", "Отмена", wsTabStop|bsPushButton, 0, 446, 334, 110, 34, idCancel, a.font)
	a.updateInstallButton()
}

func vaultItemText(v Vault) string {
	s := v.Name + "    " + v.Path
	if v.InstalledVersion != "" {
		s += "    (установлен " + v.InstalledVersion + ")"
	}
	return s
}

func (a *app) addVaultItem(v Vault) {
	procSendMessageW.Call(a.list, lbAddString, 0, ptr(vaultItemText(v)))
}

func (a *app) selected() int {
	i, _, _ := procSendMessageW.Call(a.list, lbGetCurSel, 0, 0)
	n := int(int32(i))
	if n < 0 || n >= len(a.vaults) {
		return -1
	}
	return n
}

func (a *app) updateInstallButton() {
	text := "Установить"
	if i := a.selected(); i >= 0 && a.vaults[i].InstalledVersion != "" {
		text = "Обновить"
	}
	procSetWindowTextW.Call(a.installBtn, ptr(text))
}

func wndProc(hwnd, msg, wParam, lParam uintptr) uintptr {
	switch msg {
	case wmCommand:
		id, code := wParam&0xffff, (wParam>>16)&0xffff
		switch id {
		case idInstall:
			ui.install()
		case idCancel:
			procDestroyWindow.Call(hwnd)
		case idBrowse:
			ui.browse()
		case idList:
			switch code {
			case lbnDblClk:
				ui.install()
			case lbnSelChange:
				ui.updateInstallButton()
			}
		}
		return 0
	case wmCtlColorStatic:
		procSetBkMode.Call(wParam, 1) // TRANSPARENT: labels sit on the white window background
		bg, _, _ := procGetSysColorBrush.Call(colorWindow)
		return bg
	case wmClose:
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, msg, wParam, lParam)
	return r
}

func messageBox(owner uintptr, text string, flags uintptr) int {
	r, _, _ := procMessageBoxW.Call(owner, ptr(text), ptr(windowTitle), flags)
	return int(r)
}

func (a *app) install() {
	i := a.selected()
	if i < 0 {
		messageBox(a.hwnd, "Выберите хранилище в списке или нажмите «Другая папка…».", mbOK|mbIconInformation)
		return
	}
	v := a.vaults[i]

	obsidianWasOpen := false
	for obsidianRunning() {
		r := messageBox(a.hwnd, "Obsidian сейчас открыт.\n\n"+
			"Закройте Obsidian (все его окна) и нажмите «Повторить».\n"+
			"Или нажмите «Продолжить», чтобы установить сразу. Тогда после установки перезапустите Obsidian сами.",
			mbCancelTryCont|mbIconWarning)
		if r == idContinue {
			obsidianWasOpen = true
			break
		}
		if r != idTryAgain {
			return
		}
	}

	res, err := Install(v.Path, a.payload)
	if err != nil {
		messageBox(a.hwnd, "Установить не получилось.\n\n"+err.Error(), mbOK|mbIconError)
		return
	}

	var b strings.Builder
	switch {
	case res.PreviousVersion == "":
		fmt.Fprintf(&b, "Готово! ArchiVarious %s установлен в хранилище «%s» и включён.", a.payload.Version, v.Name)
	case res.PreviousVersion == a.payload.Version:
		fmt.Fprintf(&b, "Готово! ArchiVarious %s переустановлен в хранилище «%s» и включён.", a.payload.Version, v.Name)
	default:
		fmt.Fprintf(&b, "Готово! ArchiVarious обновлён с %s до %s в хранилище «%s».",
			res.PreviousVersion, a.payload.Version, v.Name)
	}
	if res.BackupPath != "" {
		fmt.Fprintf(&b, "\n\nСписок плагинов хранилища был повреждён, его копия сохранена в %s.", res.BackupPath)
	}
	b.WriteString("\n\nЕсли Obsidian спросит, доверяете ли вы автору хранилища, выберите вариант, который включает плагины. " +
		"Если плагина не видно: Настройки > Сторонние плагины > «Включить сторонние плагины».")

	if obsidianWasOpen {
		b.WriteString("\n\nТеперь перезапустите Obsidian: закройте его и откройте снова, чтобы плагин загрузился.")
		messageBox(a.hwnd, b.String(), mbOK|mbIconInformation)
	} else {
		b.WriteString("\n\nОткрыть хранилище в Obsidian сейчас?")
		if messageBox(a.hwnd, b.String(), mbYesNo|mbIconInformation) == idYes {
			openInObsidian(a.hwnd, v.Path)
		}
	}
	procDestroyWindow.Call(a.hwnd)
}

func (a *app) browse() {
	display := make([]uint16, syscall.MAX_PATH)
	bi := browseInfo{
		owner:       a.hwnd,
		displayName: &display[0],
		title:       u16("Выберите папку хранилища Obsidian: ту, которую вы открываете в Obsidian."),
		flags:       0x1 | 0x40 | 0x200, // RETURNONLYFSDIRS | NEWDIALOGSTYLE | NONEWFOLDERBUTTON
	}
	pidl, _, _ := procSHBrowseForFolderW.Call(uintptr(unsafe.Pointer(&bi)))
	if pidl == 0 {
		return
	}
	buf := make([]uint16, syscall.MAX_PATH)
	ok, _, _ := procSHGetPathFromIDList.Call(pidl, uintptr(unsafe.Pointer(&buf[0])))
	procCoTaskMemFree.Call(pidl)
	if ok == 0 {
		messageBox(a.hwnd, "Эту папку выбрать нельзя. Выберите обычную папку на диске.", mbOK|mbIconWarning)
		return
	}
	path := vaultRootOf(syscall.UTF16ToString(buf))

	if !LooksLikeVault(path) {
		r := messageBox(a.hwnd, "В папке «"+path+"» нет служебной папки .obsidian, поэтому она не похожа на хранилище Obsidian.\n\n"+
			"Обычно нужно выбрать папку, которую вы открываете в Obsidian. Всё равно установить сюда?",
			mbYesNo|mbIconQuestion)
		if r != idYes {
			return
		}
	}

	for i, v := range a.vaults {
		if strings.EqualFold(v.Path, path) {
			procSendMessageW.Call(a.list, lbSetCurSel, uintptr(i), 0)
			a.updateInstallButton()
			return
		}
	}
	v := NewVault(path)
	a.vaults = append(a.vaults, v)
	a.addVaultItem(v)
	procSendMessageW.Call(a.list, lbSetCurSel, uintptr(len(a.vaults)-1), 0)
	procSetWindowTextW.Call(a.hint, ptr("Выберите хранилище:"))
	a.updateInstallButton()
	procSetFocus.Call(a.installBtn)
}

// vaultRootOf maps a folder inside .obsidian (people often pick .obsidian or its plugins folder) to the vault.
func vaultRootOf(path string) string {
	p := filepath.Clean(path)
	for dir := p; ; {
		if strings.EqualFold(filepath.Base(dir), ".obsidian") {
			return filepath.Dir(dir)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return p
		}
		dir = parent
	}
}

func obsidianRunning() bool {
	snap, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(snap)
	var pe syscall.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	for err = syscall.Process32First(snap, &pe); err == nil; err = syscall.Process32Next(snap, &pe) {
		if strings.EqualFold(syscall.UTF16ToString(pe.ExeFile[:]), "Obsidian.exe") {
			return true
		}
	}
	return false
}

func openInObsidian(owner uintptr, vault string) {
	uri := "obsidian://open?path=" + strings.ReplaceAll(url.QueryEscape(vault), "+", "%20")
	r, _, _ := procShellExecuteW.Call(owner, ptr("open"), ptr(uri), 0, 0, swShowNormal)
	if r <= 32 {
		messageBox(owner, "Не получилось открыть Obsidian. Откройте его сами: плагин уже установлен.", mbOK|mbIconWarning)
	}
}
