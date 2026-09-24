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

/// 淡蓝磨砂：Mica 优先——它不随窗口聚焦/失焦变化（用户反馈 Acrylic 两态透明度不一致）；
/// 失败则退回纯 CSS 半透明玻璃层，功能无损。
pub fn apply_blur(window: &WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_mica;
        let _ = apply_mica(window, None);
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
            persist_geometry(
                &handle,
                (
                    win.outer_position().map(|p| p.x).unwrap_or(0),
                    win.outer_position().map(|p| p.y).unwrap_or(0),
                ),
                (
                    win.outer_size().map(|s| s.width).unwrap_or(0),
                    win.outer_size().map(|s| s.height).unwrap_or(0),
                ),
            );
        }
    });
}

/// 只更新几何，其余字段（置顶、透明度）保留现值，避免拖动把它们冲掉。
fn persist_geometry(handle: &AppHandle, pos: (i32, i32), size: (u32, u32)) {
    let state = handle.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    let mut ws = db.window.unwrap_or_default();
    ws.x = pos.0;
    ws.y = pos.1;
    ws.width = size.0;
    ws.height = size.1;
    db.window = Some(ws);
    let result = crate::store::save(&db, &state.path);
    drop(db);
    if let Err(e) = result {
        eprintln!("窗口几何落盘失败：{e}");
    }
}
