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

/// 悬浮球几何与形态：收球=捕获真实几何→关 resizable→缩到球尺寸→**清掉 Acrylic 材质**
/// （材质涂满整个矩形窗口，不清掉就无法呈现正圆——四角会露灰）；展球=恢复真实几何+重涂材质。
/// Win11 会给所有窗口自动圆角（DWM 系统行为），64px 小窗被切角后正圆变不规则椭圆——
/// 球模式显式关掉系统圆角，展开恢复。
#[cfg(target_os = "windows")]
pub fn set_corner_preference(hwnd_raw: *mut core::ffi::c_void, round: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWM_WINDOW_CORNER_PREFERENCE,
    };
    // DWMWCP_DONOTROUND = 1, DWMWCP_ROUND = 2
    let pref = DWM_WINDOW_CORNER_PREFERENCE(if round { 2 } else { 1 });
    unsafe {
        let _ = DwmSetWindowAttribute(
            HWND(hwnd_raw),
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &pref as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
    }
}

/// 悬浮球切换（独立球窗口架构）：收球=主窗隐藏+球窗显示（就地出现）；
/// 展开=球窗当前位置显示主窗（尺寸取 pre_ball，出屏钳位）。两窗口尺寸终生不变，
/// 规避同窗口变形与 DWM/阴影/最小尺寸/WebView 重排的全部竞态。
pub fn switch_ball_mode(app: &AppHandle, on: bool) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Some(ball) = app.get_webview_window("ball") else {
        return;
    };
    let state = app.state::<AppState>();
    if on {
        let pos = main.outer_position().unwrap_or_default();
        let size = main.outer_size().unwrap_or_default();
        {
            let mut db = state.db.lock().unwrap();
            let ws = *db.window.get_or_insert_with(Default::default);
            db.pre_ball = Some(WindowState {
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                always_on_top: ws.always_on_top,
                opacity: ws.opacity,
                ball_mode: false,
            });
        }
        let _ = ball.set_position(PhysicalPosition::new(pos.x, pos.y));
        let _ = ball.show();
        let _ = main.hide();
        eprintln!("[球] 收球 主窗隐藏，球就位 ({},{})", pos.x, pos.y);
    } else {
        // 主窗在球的当前位置展开；出屏钳位（球贴边时展开不越过屏幕）
        let ball_pos = ball.outer_position().unwrap_or_default();
        let scale = ball.scale_factor().unwrap_or(1.0);
        let target = {
            let db = state.db.lock().unwrap();
            match db.pre_ball {
                Some(pre) if pre.width >= MIN_VALID_W => (pre.width, pre.height, pre.opacity),
                _ => {
                    let ws = db.window.unwrap_or_default();
                    (DEFAULT_W, DEFAULT_H, ws.opacity)
                }
            }
        };
        // pre_ball 是物理像素；set_size 用逻辑值表达同一视觉尺寸
        let _ = main.set_size(tauri::LogicalSize::new(
            target.0 as f64 / scale,
            target.1 as f64 / scale,
        ));
        // 出屏钳位：主窗右/下边缘不越出球所在显示器
        if let Ok(Some(monitor)) = ball.current_monitor() {
            let m_w = monitor.size().width as i32;
            let m_h = monitor.size().height as i32;
            let x = ball_pos.x.clamp(0, (m_w - target.0 as i32).max(0));
            let y = ball_pos.y.clamp(0, (m_h - target.1 as i32).max(0));
            let _ = main.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = main.set_position(PhysicalPosition::new(ball_pos.x, ball_pos.y));
        }
        let _ = main.show();
        let _ = main.set_focus();
        let _ = ball.hide();
        {
            let mut db = state.db.lock().unwrap();
            if let Some(w) = db.window.as_mut() {
                w.ball_mode = false;
            }
            db.pre_ball = None;
        }
        eprintln!("[球] 展开 主窗于球位置显示，球窗隐藏");
    }
}


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
