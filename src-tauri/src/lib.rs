mod commands;
mod store;
mod todo;
mod tray;
mod window;

use tauri::Manager;

use crate::commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例：二次启动唤起已有主窗，而不是开新进程
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let db_path = handle
                .path()
                .app_data_dir()
                .expect("无法定位用户数据目录")
                .join("data.json");
            let db = store::load(&db_path).unwrap_or_else(|e| {
                eprintln!("{e}；已从空数据库启动");
                todo::new_database()
            });
            app.manage(commands::AppState {
                db: std::sync::Mutex::new(db),
                path: db_path,
            });

            let window = handle.get_webview_window("main").expect("缺少主窗口");
            let saved_opacity = handle
                .state::<AppState>()
                .db
                .lock()
                .unwrap()
                .window
                .and_then(|w| w.opacity)
                .unwrap_or(0.5);
            window::apply_startup_geometry(&handle, &window);
            window::apply_blur(&window, saved_opacity);
            window::watch_geometry(&handle, &window);
            tray::setup(&handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::add_task,
            commands::toggle_done,
            commands::set_kind,
            commands::edit_text,
            commands::delete_task,
            commands::set_always_on_top,
            commands::set_opacity,
            commands::log_frontend,
            commands::hide_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
