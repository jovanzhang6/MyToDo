//! 托盘：显示/隐藏、置顶开关、开机自启开关、退出。自启状态以系统注册态为唯一事实源。

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::commands::AppState;

pub struct TrayHandles {
    pub pin: CheckMenuItem<Wry>,
    pub autostart: CheckMenuItem<Wry>,
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let always_on_top = {
        let state = app.state::<AppState>();
        let db = state.db.lock().unwrap();
        crate::todo::always_on_top(&db)
    };
    let autostart_enabled = {
        use tauri_plugin_autostart::ManagerExt;
        app.autolaunch().is_enabled().unwrap_or(false)
    };

    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let pin = CheckMenuItem::with_id(app, "pin", "窗口置顶", true, always_on_top, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "开机自启",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &PredefinedMenuItem::separator(app)?,
            &pin,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("no default icon").clone())
        .menu(&menu)
        .tooltip("MyToDo")
        // 左键单击 = 显示/隐藏切换；右键才弹菜单（业主交互约定）
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle_main(app),
            "quit" => app.exit(0),
            "pin" => {
                let checked = app
                    .state::<TrayHandles>()
                    .pin
                    .is_checked()
                    .unwrap_or(false);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_always_on_top(checked);
                }
                // 短锁改内存态 + 后台串行落盘 + 广播前端：主线程不做文件 IO（AppHangB1 教训）
                {
                    let state = app.state::<AppState>();
                    let mut db = state.db.lock().unwrap_or_else(|e| e.into_inner());
                    let ws = db.window.get_or_insert_with(Default::default);
                    ws.always_on_top = checked;
                }
                let _ = app.emit("state-changed", ());
                let app2 = app.clone();
                std::thread::spawn(move || {
                    let state = app2.state::<AppState>();
                    if let Err(e) = crate::store::save_latest(&state.db, &state.path) {
                        crate::logging::log_line(&format!("置顶状态落盘失败：{e}"));
                    }
                });
            }
            "autostart" => {
                use tauri_plugin_autostart::ManagerExt;
                let item = &app.state::<TrayHandles>().autostart;
                let checked = item.is_checked().unwrap_or(false);
                let launcher = app.autolaunch();
                let res = if checked {
                    launcher.enable()
                } else {
                    launcher.disable()
                };
                match res {
                    Ok(()) => {
                        let _ = app.emit("state-changed", ());
                    }
                    Err(e) => {
                        let _ = item.set_checked(!checked);
                        crate::logging::log_line(&format!("托盘切换开机自启失败：{e}"));
                    }
                }
            }
            _ => {}
        })
        .build(app)?;

    app.manage(TrayHandles { pin, autostart });
    Ok(())
}

/// 主窗显示/隐藏切换（托盘菜单用；应用常驻，隐藏不退出）。
pub fn toggle_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        // 球模式下主窗天然隐藏，直接 show 会和球同屏——统一走 show_main 就地展开收球
        crate::window::show_main(app);
    }
}
