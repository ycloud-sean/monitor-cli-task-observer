use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let icon = app.default_window_icon().cloned().expect("default icon");

            let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Monitor")
                .inner_size(380.0, 560.0)
                .visible(false)
                .resizable(false)
                .build()?;

            TrayIconBuilder::with_id("monitor-tray")
                .icon(icon)
                .tooltip("Monitor")
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
