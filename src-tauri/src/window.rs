//! 窗口壳：默认右上角定位、磨砂背景（三级回退）、几何状态记忆。

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent};

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

/// Win11 给所有窗口画 1px 系统边框（白背景上悬浮球的"灰色圆角框"就是它）——
/// 球窗显式把边框颜色设为 NONE（DWMWA_COLOR_NONE）。
#[cfg(target_os = "windows")]
pub fn set_border_none(hwnd_raw: *mut core::ffi::c_void) {
    use windows::Win32::Foundation::{COLORREF, HWND};
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR};
    let none = COLORREF(0xFFFF_FFFE);
    unsafe {
        let _ = DwmSetWindowAttribute(
            HWND(hwnd_raw),
            DWMWA_BORDER_COLOR,
            &none as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<COLORREF>() as u32,
        );
    }
}

static BALL_DRAGGING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// 悬停滑出态：true 时守护线程暂停贴边强制（用户正在看全露的球）
static BALL_UNDOCKED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static BALL_LAST_POS: std::sync::Mutex<Option<(i32, i32)>> = std::sync::Mutex::new(None);
static BALL_STABLE_TICKS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// 悬浮球守护线程（400ms 一拍）维持不变式：**球窗可见 = 必然处于贴点位**。
/// - 拖拽中：连续两拍位置静止 → 视为松手，清除拖拽态
/// - 悬停滑出态：守护线程暂停强制（用户正在看）
/// - 非拖拽且不在贴点位 → 平滑滑回贴点位（拖到中间/任何漂移都会被拉回）
pub fn start_ball_watcher(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    let a = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let Some(ball) = a.get_webview_window("ball") else {
            continue;
        };
        if !ball.is_visible().unwrap_or(false) {
            continue;
        }
        let Ok(pos) = ball.outer_position() else {
            continue;
        };
        if BALL_DRAGGING.load(Ordering::SeqCst) || BALL_UNDOCKED.load(Ordering::SeqCst) {
            let mut last = BALL_LAST_POS.lock().unwrap();
            if *last == Some((pos.x, pos.y)) {
                let n = BALL_STABLE_TICKS.fetch_add(1, Ordering::SeqCst) + 1;
                if n >= 2 {
                    BALL_DRAGGING.store(false, Ordering::SeqCst);
                    BALL_STABLE_TICKS.store(0, Ordering::SeqCst);
                    eprintln!("[球] 拖拽静止两拍，视为松手");
                }
            } else {
                BALL_STABLE_TICKS.store(0, Ordering::SeqCst);
                *last = Some((pos.x, pos.y));
            }
            continue;
        }
        // 非拖拽：不在贴点位就滑回（含收球初现、拖到中间松手等一切情况）
        let Ok(size) = ball.outer_size() else {
            continue;
        };
        let Some(Some(mon)) = ball.current_monitor().ok() else {
            continue;
        };
        let m = (
            mon.position().x,
            mon.position().y,
            mon.size().width,
            mon.size().height,
        );
        let (tx, ty) = dock_target(m, (pos.x, pos.y, size.width, size.height));
        if (pos.x, pos.y) != (tx, ty) {
            glide_ball(&a, tx, ty);
        }
    });
}

/// 立即贴边（拖拽松手/悬停移开/守护兜底共用）：滑向贴点位，解除悬停态。
pub fn dock_now(app: &AppHandle) {
    let Some(ball) = app.get_webview_window("ball") else {
        return;
    };
    // 拖拽进行中不插手（守护线程同样跳过）
    if BALL_DRAGGING.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    if !ball.is_visible().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(size)) = (ball.outer_position(), ball.outer_size()) else {
        return;
    };
    let Some(Some(mon)) = ball.current_monitor().ok() else {
        return;
    };
    let m = (
        mon.position().x,
        mon.position().y,
        mon.size().width,
        mon.size().height,
    );
    let (x, y) = dock_target(m, (pos.x, pos.y, size.width, size.height));
    glide_ball(app, x, y);
    BALL_UNDOCKED.store(false, std::sync::atomic::Ordering::SeqCst);
}

/// 悬停滑出：贴点位 → 同边全可见（动画），守护线程暂停强制直至重新贴边。
pub fn undock_now(app: &AppHandle) {
    // 拖拽进行中不插手
    if BALL_DRAGGING.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let Some(ball) = app.get_webview_window("ball") else {
        return;
    };
    if !ball.is_visible().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(size)) = (ball.outer_position(), ball.outer_size()) else {
        return;
    };
    let Some(Some(mon)) = ball.current_monitor().ok() else {
        return;
    };
    let m = (
        mon.position().x,
        mon.position().y,
        mon.size().width,
        mon.size().height,
    );
    let dock_left = pos.x + size.width as i32 / 2 < m.0 + m.2 as i32 / 2;
    let x = if dock_left { m.0 } else { m.0 + m.2 as i32 - size.width as i32 };
    let y = pos.y.clamp(m.1, m.1 + m.3 as i32 - size.height as i32);
    BALL_UNDOCKED.store(true, std::sync::atomic::Ordering::SeqCst);
    glide_ball(app, x, y);
}

/// 球窗自绘拖拽（Rust 轮询鼠标，16ms 跟手）：松手瞬间判定——
/// 位移 ≤5px = 点击展开主窗；超过 = 拖拽完成，立即贴边（守护线程此后仅兜底）。
pub fn start_ball_drag(app: AppHandle) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    use std::sync::atomic::Ordering;
    std::thread::spawn(move || {
        let Some(ball) = app.get_webview_window("ball") else {
            return;
        };
        let mut start_cur = POINT::default();
        if unsafe { GetCursorPos(&mut start_cur) }.is_err() {
            return;
        };
        let Ok(start_ball) = ball.outer_position() else {
            return;
        };
        let offset = (start_ball.x - start_cur.x, start_ball.y - start_cur.y);
        BALL_DRAGGING.store(true, Ordering::SeqCst);
        let mut engaged = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(16));
            let mut cur = POINT::default();
            if unsafe { GetCursorPos(&mut cur) }.is_err() {
                break;
            };
            let pressed = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0;
            if !pressed {
                break; // 松手瞬间退出循环，走下方判定
            }
            let dx = cur.x - start_cur.x;
            let dy = cur.y - start_cur.y;
            if !engaged && dx * dx + dy * dy > 25 {
                engaged = true;
            }
            if engaged {
                let _ = ball.set_position(PhysicalPosition::new(
                    cur.x + offset.0,
                    cur.y + offset.1,
                ));
            }
        }
        BALL_DRAGGING.store(false, Ordering::SeqCst);
        if engaged {
            // 拖拽完成 → 立即贴边
            dock_now(&app);
        } else {
            // 点击 → 展开主窗
            switch_ball_mode(&app, false);
            let _ = app.emit("state-changed", ());
        }
    });
}

/// 悬浮球切换（独立球窗口架构）：收球=主窗隐藏+球窗显示（就地出现）；
/// 展开=球窗当前位置显示主窗（尺寸取 pre_ball，出屏钳位）。两窗口尺寸终生不变，
/// 规避同窗口变形与 DWM/阴影/最小尺寸/WebView 重排的全部竞态。
pub fn switch_ball_mode(app: &AppHandle, on: bool) {
    eprintln!("[球] switch_ball_mode 进入 on={on}");
    let Some(main) = app.get_webview_window("main") else {
        eprintln!("[球] 主窗不存在！");
        return;
    };
    let Some(ball) = app.get_webview_window("ball") else {
        eprintln!("[球] 球窗不存在！");
        return;
    };
    let state = app.state::<AppState>();
    if on {
        let pos = main.outer_position().unwrap_or_default();
        // 客户区尺寸入账（outer 含边框补偿且每轮 set_size 复利膨胀，inner 恒定）
        let (Ok(csize), Ok(osize)) = (main.inner_size(), main.outer_size()) else {
            return;
        };
        let border = (osize.width - csize.width, osize.height - csize.height);
        {
            let mut db = state.db.lock().unwrap();
            let ws = *db.window.get_or_insert_with(Default::default);
            db.pre_ball = Some(WindowState {
                x: pos.x,
                y: pos.y,
                width: csize.width,
                height: csize.height,
                always_on_top: ws.always_on_top,
                opacity: ws.opacity,
                ball_mode: false,
            });
        }
        // 两段式收球动画：主窗位置全露出现 → 滑到边（全露）→ 缩进（露 60% 藏 40%）
        // 动画期间置拖拽态抑制守护线程，结束时由守护线程的静止判定自然解除
        let Some(Some(mon)) = main.current_monitor().ok() else {
            return;
        };
        let m = (
            mon.position().x,
            mon.position().y,
            mon.size().width,
            mon.size().height,
        );
        let (edge_x, edge_y) = (
            if pos.x + BALL_SIZE as i32 as i32 / 2 < m.0 + m.2 as i32 / 2 {
                m.0
            } else {
                m.0 + m.2 as i32 - BALL_SIZE as i32
            },
            pos.y.clamp(m.1, m.1 + m.3 as i32 - BALL_SIZE as i32),
        );
        let (dock_x, dock_y) = dock_target(m, (edge_x, edge_y, BALL_SIZE, BALL_SIZE));
        let _ = ball.set_position(PhysicalPosition::new(pos.x, pos.y));
        let _ = ball.show();
        // 显示时强制重设尺寸并记录：创建时的 64×64 逻辑宽被某处撑到 135（实测），此处钳回
        let _ = ball.set_size(tauri::LogicalSize::new(56.0, 56.0));
        let _ = main.hide();
        BALL_DRAGGING.store(true, std::sync::atomic::Ordering::SeqCst);
        {
            // 收球动画（时间驱动，8ms 一拍按真实流逝时间取位，免疫睡眠抖动）：
            // 0–55% 主窗位置 → 边上全露（ease-out）；55–100% 边上 → 缩进贴点位（ease-in-out），无停顿
            let a2 = app.clone();
            let ball2 = ball.clone();
            std::thread::spawn(move || {
                const TOTAL: std::time::Duration = std::time::Duration::from_millis(420);
                let t0 = std::time::Instant::now();
                let ease_out = |t: f64| 1.0 - (1.0 - t) * (1.0 - t);
                let ease_in_out = |t: f64| {
                    if t < 0.5 {
                        2.0 * t * t
                    } else {
                        1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
                    }
                };
                loop {
                    let p = (t0.elapsed().as_secs_f64()
                        / TOTAL.as_secs_f64())
                    .min(1.0);
                    let (x, y) = if p < 0.55 {
                        let k = ease_out(p / 0.55);
                        (
                            pos.x as f64 + (edge_x - pos.x) as f64 * k,
                            pos.y as f64 + (edge_y - pos.y) as f64 * k,
                        )
                    } else {
                        let k = ease_in_out((p - 0.55) / 0.45);
                        (
                            edge_x as f64 + (dock_x - edge_x) as f64 * k,
                            edge_y as f64 + (dock_y - edge_y) as f64 * k,
                        )
                    };
                    let _ = ball2.set_position(PhysicalPosition::new(
                        x.round() as i32,
                        y.round() as i32,
                    ));
                    if !ball2.is_visible().unwrap_or(false) || p >= 1.0 {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(8));
                }
                BALL_DRAGGING.store(false, std::sync::atomic::Ordering::SeqCst);
                let _ = a2;
            });
        }
        let bsize = ball.outer_size().map(|s| (s.width, s.height));
        let bscale = ball.scale_factor().unwrap_or(1.0);
        eprintln!(
            "[球] 收球 主窗隐藏，两段动画就位 ({},{})→边({},{})→贴({},{}) 尺寸={bsize:?} scale={bscale} 客户区={csize:?} 客户区={csize:?}",
            pos.x, pos.y, edge_x, edge_y, dock_x, dock_y
        );
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
        // 实测（探针）：这套无边框窗口的 set_size 语义即“设客户区”——
        // 请求 (1014,891) 落地 inner=(1014,891)。因此直接设目标值，禁止任何边框补偿
        //（补偿即膨胀：v0.1.1 每轮 +22×13 的根因）。
        let _ = main.set_size(tauri::PhysicalSize::new(target.0, target.1));
        std::thread::sleep(std::time::Duration::from_millis(120));
        let after = (
            main.inner_size().map(|s| (s.width, s.height)),
            main.outer_size().map(|s| (s.width, s.height)),
        );
        eprintln!(
            "[球] 展开尺寸 目标客户区=({},{}) 落地后 内/外={after:?}",
            target.0, target.1
        );
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
        eprintln!("[球] 展开步骤全部完成");
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

pub const BALL_SIZE: u32 = 56;
const DEFAULT_W: u32 = 300;
const DEFAULT_H: u32 = 520;

/// 贴边时藏出屏外的球身比例（露 60%，数字仍可读；悬停滑回全露）
pub const DOCK_HIDDEN_RATIO: f64 = 0.4;

/// 贴边目标位置（纯函数，单测对象）：水平就近选边，垂直原位钳屏内；
/// 露 60%、藏 DOCK_HIDDEN_RATIO 出屏。monitor/ball 均为物理像素全局坐标。
pub fn dock_target(
    monitor: (i32, i32, u32, u32),
    ball: (i32, i32, u32, u32),
) -> (i32, i32) {
    let (mx, my, mw, mh) = monitor;
    let (bx, by, bw, bh) = ball;
    let dock_left = bx + bw as i32 / 2 < mx + mw as i32 / 2;
    let hidden = (bw as f64 * DOCK_HIDDEN_RATIO).round() as i32;
    let x = if dock_left {
        mx - hidden
    } else {
        mx + mw as i32 - bw as i32 + hidden
    };
    let y = by.clamp(my, my + mh as i32 - bh as i32);
    (x, y)
}
static GLIDE_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 球窗平滑滑向目标（ease-out ~290ms）。并发调用以最新目标为准（代际计数使旧动画失效）。
pub fn glide_ball(app: &AppHandle, tx: i32, ty: i32) {
    use std::sync::atomic::Ordering;
    let Some(ball) = app.get_webview_window("ball") else {
        return;
    };
    let Ok(from) = ball.outer_position() else {
        return;
    };
    let gen = GLIDE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let dx = tx - from.x;
    let dy = ty - from.y;
    if dx == 0 && dy == 0 {
        return;
    }
    std::thread::spawn(move || {
        const STEPS: u32 = 12;
        for i in 1..=STEPS {
            if GLIDE_GEN.load(Ordering::SeqCst) != gen {
                return; // 有更新的目标接管
            }
            std::thread::sleep(std::time::Duration::from_millis(24));
            let t = i as f64 / STEPS as f64;
            let ease = 1.0 - (1.0 - t) * (1.0 - t);
            let _ = ball.set_position(PhysicalPosition::new(
                from.x + (dx as f64 * ease).round() as i32,
                from.y + (dy as f64 * ease).round() as i32,
            ));
        }
    });
}

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
                    win.inner_size().map(|s| s.width).unwrap_or(0),
                    win.inner_size().map(|s| s.height).unwrap_or(0),
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

#[cfg(test)]
mod tests {
    use super::dock_target;

    const MON: (i32, i32, u32, u32) = (0, 0, 1920, 1080);
    const BALL: (i32, i32, u32, u32) = (900, 500, 56, 56);

    #[test]
    fn dock_picks_nearest_horizontal_edge() {
        // 球在屏幕左半 → 贴左；右半 → 贴右
        let (x, _) = dock_target(MON, (100, 500, 56, 56));
        assert_eq!(x, -22, "左贴：藏 40% 出左屏（56*0.4≈22）");
        let (x, _) = dock_target(MON, (1700, 500, 56, 56));
        assert_eq!(x, 1920 - 56 + 22, "右贴：藏 40% 出右屏");
    }

    #[test]
    fn dock_keeps_y_clamped_in_monitor() {
        let (x, y) = dock_target(MON, (100, -30, 56, 56));
        assert_eq!((x, y), (-22, 0), "越出屏顶 → 钳回 0");
        let (_, y) = dock_target(MON, (100, 2000, 56, 56));
        assert_eq!(y, 1080 - 56, "越出屏底 → 钳回屏内");
    }

    #[test]
    fn dock_is_idempotent_at_edge() {
        let docked = dock_target(MON, BALL);
        let again = dock_target(MON, (docked.0, docked.1, BALL.2, BALL.3));
        assert_eq!(docked, again, "重复贴边不漂移");
    }

    #[test]
    fn dock_works_on_secondary_monitor() {
        // 副屏在主屏右侧：x 从 1920 起
        let sec: (i32, i32, u32, u32) = (1920, 0, 1920, 1080);
        let (x, _) = dock_target(sec, (2600, 500, 56, 56));
        assert_eq!(x, 1920 - 22, "副屏左贴以副屏原点为基准");
    }
}
