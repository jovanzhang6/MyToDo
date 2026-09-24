//! 托盘：显示/隐藏、置顶开关、开机自启开关、退出。自启状态以系统注册态为唯一事实源。

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

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
                let state = app.state::<AppState>();
                {
                    let mut db = state.db.lock().unwrap();
                    let ws = db.window.get_or_insert_with(Default::default);
                    ws.always_on_top = checked;
                }
                let _ = crate::store::save(&state.db.lock().unwrap(), &state.path);
            }
            "autostart" => {
                use tauri_plugin_autostart::ManagerExt;
                let checked = app
                    .state::<TrayHandles>()
                    .autostart
                    .is_checked()
                    .unwrap_or(false);
                let launcher = app.autolaunch();
                let _ = if checked {
                    launcher.enable()
                } else {
                    launcher.disable()
                };
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
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
