mod commands;
mod notify;
mod stats;
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
            // 几何/材质就绪后再显示，避免「左上角白窗闪现再跳右上角」
            window.show().expect("无法显示主窗口");

            // 悬浮球窗口：启动即创建、隐藏待命；尺寸终生不变（独立窗口架构）
            use tauri::{WebviewUrl, WebviewWindowBuilder};
            let ball = WebviewWindowBuilder::new(
                &handle,
                "ball",
                WebviewUrl::App("index.html?view=ball".into()),
            )
            .title("MyToDo")
            .inner_size(56.0, 56.0)
            .decorations(false)
            .transparent(true)
            .resizable(false)
            .shadow(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible(false)
            .build()?;
            #[cfg(target_os = "windows")]
            {
                let hwnd = ball.hwnd().map(|h| h.0).unwrap_or(std::ptr::null_mut());
                window::set_corner_preference(hwnd, false);
                window::set_border_none(hwnd);
            }
            let _ = ball;

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
            commands::set_reminders_enabled,
            commands::set_backlog_days,
            commands::set_autostart,
            commands::set_ball_mode,
            commands::log_frontend,
            commands::hide_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
