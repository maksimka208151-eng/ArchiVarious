mod inbox;

#[cfg(desktop)]
mod desktop;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // The single-instance plugin must be registered first. A second launch (for example autostart plus
    // a manual start) just brings the existing widget forward.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::summon(app, false);
        }))
        .plugin(
            // Only the position is remembered: the window height follows the content (bar or survey).
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));

    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            inbox::write_capture,
            inbox::write_note_unique,
            inbox::ensure_note,
            inbox::scan_vault,
            inbox::read_plugin_data,
            inbox::read_sections,
            inbox::write_sections
        ]);

    #[cfg(desktop)]
    let builder = builder
        .setup(|app| {
            desktop::setup(app)?;
            Ok(())
        })
        // No close button exists on the frameless widget, but Alt+F4 must not kill it either:
        // it hides to the tray, and "Quit" in the tray menu is the way out.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                desktop::set_front(false);
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running ArchiVarious");
}
