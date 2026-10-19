use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Listener, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Whether the widget is summoned (in front of other windows). It stays in front until the user dismisses it
/// with Esc or the hotkey; losing focus does not dismiss it (a drag or a click elsewhere would otherwise send
/// it under other windows).
static FRONT: AtomicBool = AtomicBool::new(false);

/// Desktop widget behaviour. The widget lives on the desktop as a frameless bar (see `tauri.conf.json`);
/// the global hotkey (Ctrl/Cmd+Shift+Space) toggles it to the front and back, the tray icon and a second
/// launch bring it to the front and focus the input. The webview decides how to put it back (it knows the
/// "desktop" / "on top" mode) and reports Esc with a `dismissed` event.
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
                    if FRONT.swap(false, Ordering::SeqCst) {
                        dismiss(app);
                    } else {
                        summon(app, false);
                    }
                }
            })
            .build(),
    )?;
    if let Err(error) = app.global_shortcut().register(hotkey) {
        // Another app may own the hotkey; the tray icon still works.
        eprintln!("ArchiVarious: could not register global shortcut: {error}");
    }

    app.listen_any("dismissed", |_| set_front(false));

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
    set_front(true);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("summon", open_settings);
    }
}

/// Tells the webview to put the widget back where it lives.
fn dismiss(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("dismiss", ());
    }
}

pub fn set_front(front: bool) {
    FRONT.store(front, Ordering::SeqCst);
}
