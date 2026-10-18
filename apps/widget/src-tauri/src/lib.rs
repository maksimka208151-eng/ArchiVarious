mod inbox;

#[cfg(desktop)]
mod desktop;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![inbox::write_capture]);

    #[cfg(desktop)]
    let builder = builder.setup(|app| {
        desktop::setup(app)?;
        Ok(())
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running ArchiVarious");
}
