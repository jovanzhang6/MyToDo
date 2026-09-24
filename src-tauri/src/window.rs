//! 窗口壳：默认右上角定位、磨砂背景（三级回退）、几何状态记忆。

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow, WindowEvent};

use crate::commands::AppState;
use crate::todo::WindowState;

/// 启动时应用几何：有记忆（且尺寸合法）用记忆，否则主屏右上角留边；置顶按记忆。
pub fn apply_startup_geometry(app: &AppHandle, window: &WebviewWindow) {
    let saved = app.state::<AppState>().db.lock().unwrap().window;
    match saved {
        Some(ws) if ws.width > 0 && ws.height > 0 => {
            let _ = window.set_position(PhysicalPosition::new(ws.x, ws.y));
            let _ = window.set_size(tauri::PhysicalSize::new(ws.width, ws.height));
        }
        _ => {
            if let (Ok(Some(monitor)), Ok(size)) =
                (app.primary_monitor(), window.outer_size())
            {
                let margin = (16.0 * monitor.scale_factor()) as i32;
                let x = monitor.size().width as i32 - size.width as i32 - margin;
                let y = margin;
                let _ = window.set_position(PhysicalPosition::new(x, y));
            }
        }
    }
    let on_top = saved.map_or(true, |ws| ws.always_on_top);
    let _ = window.set_always_on_top(on_top);
}

/// 淡蓝磨砂：Acrylic 优先，失败降级 Mica；再失败保留 CSS 半透明（最坏兜底，功能无损）。
pub fn apply_blur(window: &WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};
        if apply_acrylic(window, Some((216, 233, 248, 120))).is_err() {
            let _ = apply_mica(window, None);
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;
}

/// 拖动/缩放期间事件洪泛，静默 400ms 后才把当前几何落盘。
pub fn watch_geometry(app: &AppHandle, window: &WebviewWindow) {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            let _ = tx.send(());
        }
    });
    let handle = app.clone();
    let win = window.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx.recv_timeout(std::time::Duration::from_millis(400)).is_ok() {}
            let always_on_top = current_always_on_top(&handle);
            let ws = WindowState {
                x: win.outer_position().map(|p| p.x).unwrap_or(0),
                y: win.outer_position().map(|p| p.y).unwrap_or(0),
                width: win.outer_size().map(|s| s.width).unwrap_or(0),
                height: win.outer_size().map(|s| s.height).unwrap_or(0),
                always_on_top,
            };
            persist_geometry(&handle, ws);
        }
    });
}

fn current_always_on_top(handle: &AppHandle) -> bool {
    let state = handle.state::<AppState>();
    let db = state.db.lock().unwrap();
    db.window.map_or(true, |w| w.always_on_top)
}

fn persist_geometry(handle: &AppHandle, ws: WindowState) {
    let state = handle.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    db.window = Some(ws);
    let result = crate::store::save(&db, &state.path);
    drop(db);
    if let Err(e) = result {
        eprintln!("窗口几何落盘失败：{e}");
    }
}
