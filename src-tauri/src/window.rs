//! 窗口壳：默认右上角定位、磨砂背景（三级回退）、几何状态记忆。

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow, WindowEvent};

use crate::commands::AppState;
use crate::todo::WindowState;

/// 启动时应用几何：有记忆（且尺寸合法）用记忆，否则主屏右上角留边；置顶按记忆。
pub fn apply_startup_geometry(app: &AppHandle, window: &WebviewWindow) {
    let saved = app.state::<AppState>().db.lock().unwrap().window;
    match saved {
        // 几何自愈：过小视为历史球态污染，走默认右上角
        Some(ws) if ws.width >= MIN_VALID_W && ws.height > 0 => {
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

/// 悬浮球几何：56×56 圆球。收球时先关 resizable（绕过 conf 最小尺寸约束）再 set_size；
/// 展球恢复 pre_ball 几何并重新开启缩放。程序性 set_size 不受 resizable 限制。
pub fn apply_ball_geometry(app: &AppHandle, window: &WebviewWindow, on: bool) {
    let target = {
        let state = app.state::<AppState>();
        let db = state.db.lock().unwrap();
        let ws = db.window.unwrap_or_default();
        if on {
            (ws.x, ws.y, BALL_SIZE, BALL_SIZE)
        } else {
            match db.pre_ball {
                // 几何自愈：pre_ball 异常小（历史污染）时回退默认展开尺寸
                Some(pre) if pre.width >= MIN_VALID_W => {
                    (pre.x, pre.y, pre.width, pre.height)
                }
                _ => (ws.x, ws.y, DEFAULT_W, DEFAULT_H),
            }
        }
    };
    if on {
        let _ = window.set_resizable(false);
        let _ = window.set_size(tauri::PhysicalSize::new(target.2, target.3));
        let _ = window.set_position(PhysicalPosition::new(target.0, target.1));
    } else {
        let _ = window.set_resizable(true);
        if target.2 > 0 {
            let _ = window.set_size(tauri::PhysicalSize::new(target.2, target.3));
        }
        let _ = window.set_position(PhysicalPosition::new(target.0, target.1));
        // 展开后立即把恢复的几何写为当前记忆（自愈：覆盖任何历史污染）
        persist_geometry(app, (target.0, target.1), (target.2, target.3));
    }
}

/// 展开态几何的合法下限：小于它视为球态污染，走默认值自愈
pub const MIN_VALID_W: u32 = 150;

pub const BALL_SIZE: u32 = 64;
const DEFAULT_W: u32 = 300;
const DEFAULT_H: u32 = 520;

/// 淡蓝磨砂：Acrylic 真材质，透明度直接由 tint alpha 承载（滑杆实时可调、可看穿）。
/// 注意：Windows 的 Acrylic 在窗口失焦时材质会略微变实，这是系统级行为。
/// Acrylic 不可用时退回 Mica（此时滑杆只能影响 CSS 叠层），最终兜底纯 CSS 半透明。
pub fn apply_blur(window: &WebviewWindow, opacity: f32) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};
        let alpha = (opacity.clamp(0.10, 0.95) * 255.0).round() as u8;
        if apply_acrylic(window, Some((216, 233, 248, alpha))).is_err() {
            let _ = apply_mica(window, None);
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (window, opacity);
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
/// 球模式下跳过：球的 56px 几何绝不能覆盖展开态记忆（F6）。
fn persist_geometry(handle: &AppHandle, pos: (i32, i32), size: (u32, u32)) {
    let state = handle.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    if db.window.map_or(false, |w| w.ball_mode) {
        return;
    }
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
