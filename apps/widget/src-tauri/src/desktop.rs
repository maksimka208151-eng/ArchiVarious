use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Desktop widget behaviour. The widget lives on the desktop as a frameless bar (see `tauri.conf.json`);
/// the global hotkey (Ctrl/Cmd+Shift+Space), the tray icon and a second launch bring it to the front
/// and focus the input. The webview decides how to put it back (it knows the "desktop" / "on top" mode).
pub fn setup(app: &mut App) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    let modifiers = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;
    let hotkey = Shortcut::new(Some(modifiers), Code::Space);

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if shortcut == &hotkey && event.state() == ShortcutState::Pressed {
                    summon(app, false);
                }
            })
            .build(),
    )?;
    if let Err(error) = app.global_shortcut().register(hotkey) {
        // Another app may own the hotkey; the tray icon still works.
        eprintln!("ArchiVarious: could not register global shortcut: {error}");
    }

    let show = MenuItem::with_id(app, "show", "Показать", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Настройки", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &settings, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("ArchiVarious")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => summon(app, false),
            "settings" => summon(app, true),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                summon(tray.app_handle(), false);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Shows the widget, focuses it and tells the webview (`summon` event, payload = open settings?).
pub fn summon(app: &AppHandle, open_settings: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("summon", open_settings);
    }
}
