//! 窗口壳：默认右上角定位、多屏边界兜底、磨砂背景（三级回退）、几何记忆与悬浮球动画。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};

use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, WebviewWindow, WindowEvent};

use crate::commands::AppState;
use crate::todo::WindowState;

pub const MIN_VALID_W: u32 = 150;
pub const MIN_VALID_H: u32 = 200;
pub const BALL_SIZE: u32 = 56;
const DEFAULT_W: u32 = 300;
const DEFAULT_H: u32 = 520;

/// 贴边时藏出屏外的球身比例（露 55% 左右，数字仍可读；悬停滑回全露）
pub const DOCK_HIDDEN_RATIO: f64 = 0.45;

/// 仅在动画或拖拽期间将系统时钟精度临时提升到 1ms，避免托盘长期静默时 1000Hz 空耗。
#[cfg(target_os = "windows")]
struct HighResTimerGuard;

#[cfg(target_os = "windows")]
impl HighResTimerGuard {
    fn new() -> Self {
        unsafe {
            windows::Win32::Media::timeBeginPeriod(1);
        }
        Self
    }
}

#[cfg(target_os = "windows")]
impl Drop for HighResTimerGuard {
    fn drop(&mut self) {
        unsafe {
            windows::Win32::Media::timeEndPeriod(1);
        }
    }
}

fn monitor_rect(mon: &Monitor) -> (i32, i32, u32, u32) {
    (
        mon.position().x,
        mon.position().y,
        mon.size().width,
        mon.size().height,
    )
}

/// 窗口至少有 48×48px 落在某个已连接显示器内，防止拔掉副屏或最小化异常坐标后主窗失踪。
pub fn is_rect_on_any_monitor(
    rect: (i32, i32, u32, u32),
    monitors: &[(i32, i32, u32, u32)],
) -> bool {
    const MIN_VISIBLE: i32 = 48;
    let (rx, ry, rw, rh) = rect;
    let (rw, rh) = (rw as i32, rh as i32);
    monitors.iter().any(|&(mx, my, mw, mh)| {
        let overlap_w = (rx + rw).min(mx + mw as i32) - rx.max(mx);
        let overlap_h = (ry + rh).min(my + mh as i32) - ry.max(my);
        overlap_w >= MIN_VISIBLE && overlap_h >= MIN_VISIBLE
    })
}

/// 悬浮球就地展开主窗时的多屏坐标钳位：严格以球所在显示器原点 (mx, my) 为基准，禁止错钳回主屏。
pub fn clamp_expand_pos(
    monitor: (i32, i32, u32, u32),
    ball_pos: (i32, i32),
    target_size: (u32, u32),
) -> (i32, i32) {
    let (mx, my, mw, mh) = monitor;
    let max_x = mx + (mw as i32 - target_size.0 as i32).max(0);
    let max_y = my + (mh as i32 - target_size.1 as i32).max(0);
    (ball_pos.0.clamp(mx, max_x), ball_pos.1.clamp(my, max_y))
}

/// 启动时应用几何：有记忆且尺寸/在屏合法则恢复，否则主屏右上角留边；置顶按记忆。
pub fn apply_startup_geometry(app: &AppHandle, window: &WebviewWindow) {
    let saved = app
        .state::<AppState>()
        .db
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .window;
    let monitors: Vec<(i32, i32, u32, u32)> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(monitor_rect)
        .collect();
    let valid_saved = saved.filter(|ws| {
        ws.width >= MIN_VALID_W
            && ws.height >= MIN_VALID_H
            && (monitors.is_empty()
                || is_rect_on_any_monitor((ws.x, ws.y, ws.width, ws.height), &monitors))
    });
    match valid_saved {
        Some(ws) => {
            let _ = window.set_position(PhysicalPosition::new(ws.x, ws.y));
            let _ = window.set_size(tauri::PhysicalSize::new(ws.width, ws.height));
        }
        None => {
            if let (Ok(Some(monitor)), Ok(size)) = (app.primary_monitor(), window.outer_size()) {
                let margin = (16.0 * monitor.scale_factor()) as i32;
                let (mx, my, mw, _) = monitor_rect(&monitor);
                let x = mx + mw as i32 - size.width as i32 - margin;
                let y = my + margin;
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

static BALL_DRAGGING: AtomicBool = AtomicBool::new(false);
static BALL_COLLAPSING: AtomicBool = AtomicBool::new(false);
/// 悬停滑出态：true 时守护线程暂停贴边强制（用户正在看全露的球）
static BALL_UNDOCKED: AtomicBool = AtomicBool::new(false);
/// 悬浮球动画代际计数：拖拽/收球/滑动任意一方接管时递增，立即中止旧动画线程防抢位置。
static BALL_ANIM_GEN: AtomicU64 = AtomicU64::new(0);
static BALL_WATCH_WAKE: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

fn wake_ball_watcher() {
    let (lock, cv) = &BALL_WATCH_WAKE;
    if let Ok(mut active) = lock.lock() {
        *active = true;
        cv.notify_all();
    }
}

#[cfg(target_os = "windows")]
fn is_lbutton_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 }
}

#[cfg(target_os = "windows")]
fn is_cursor_near_rect(x: i32, y: i32, w: i32, h: i32, pad: i32) -> Option<bool> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut cur = POINT::default();
    unsafe { GetCursorPos(&mut cur) }.ok()?;
    Some(cur.x >= x - pad && cur.x <= x + w + pad && cur.y >= y - pad && cur.y <= y + h + pad)
}

/// 悬浮球守护线程：球隐藏时零唤醒阻塞等待；球可见时每 400ms 维持不变式：
/// - 若 WebView2 因鼠标快速移出/切换焦点漏发 mouseleave，兜底自动贴边；
/// - 非拖拽/非悬停/非收球且未在贴点位时滑回贴点位。
pub fn start_ball_watcher(app: &AppHandle) {
    let a = app.clone();
    std::thread::spawn(move || loop {
        let Some(ball) = a.get_webview_window("ball") else {
            std::thread::sleep(std::time::Duration::from_millis(400));
            continue;
        };
        if !ball.is_visible().unwrap_or(false) {
            let (lock, cv) = &BALL_WATCH_WAKE;
            if let Ok(mut active) = lock.lock() {
                *active = false;
                while !*active {
                    active = cv.wait(active).unwrap_or_else(|e| e.into_inner());
                }
            }
            continue;
        }

        std::thread::sleep(std::time::Duration::from_millis(400));
        if !ball.is_visible().unwrap_or(false) || BALL_COLLAPSING.load(Ordering::SeqCst) {
            continue;
        }
        if BALL_DRAGGING.load(Ordering::SeqCst) {
            // 仅在左键确已松开（极端中断漏退拖拽循环）时自愈，绝不在按住静止时抢球
            #[cfg(target_os = "windows")]
            if !is_lbutton_down() {
                BALL_DRAGGING.store(false, Ordering::SeqCst);
            }
            continue;
        }
        let (Ok(pos), Ok(size)) = (ball.outer_position(), ball.outer_size()) else {
            continue;
        };
        if BALL_UNDOCKED.load(Ordering::SeqCst) {
            #[cfg(target_os = "windows")]
            if matches!(
                is_cursor_near_rect(pos.x, pos.y, size.width as i32, size.height as i32, 10),
                Some(false)
            ) {
                dock_now(&a);
            }
            continue;
        }
        let Some(Some(mon)) = ball.current_monitor().ok() else {
            continue;
        };
        let (tx, ty) = dock_target(
            monitor_rect(&mon),
            (pos.x, pos.y, size.width, size.height),
        );
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
    if BALL_DRAGGING.load(Ordering::SeqCst) || BALL_COLLAPSING.load(Ordering::SeqCst) {
        return;
    }
    BALL_UNDOCKED.store(false, Ordering::SeqCst);
    if !ball.is_visible().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(size)) = (ball.outer_position(), ball.outer_size()) else {
        return;
    };
    let Some(Some(mon)) = ball.current_monitor().ok() else {
        return;
    };
    let (x, y) = dock_target(
        monitor_rect(&mon),
        (pos.x, pos.y, size.width, size.height),
    );
    glide_ball(app, x, y);
}

/// 悬停滑出：贴点位 → 同边全可见（动画），守护线程暂停强制直至重新贴边。
pub fn undock_now(app: &AppHandle) {
    if BALL_DRAGGING.load(Ordering::SeqCst) || BALL_COLLAPSING.load(Ordering::SeqCst) {
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
    let m = monitor_rect(&mon);
    let dock_left = pos.x + size.width as i32 / 2 < m.0 + m.2 as i32 / 2;
    let x = if dock_left {
        m.0
    } else {
        m.0 + m.2 as i32 - size.width as i32
    };
    let y = pos.y.clamp(m.1, m.1 + m.3 as i32 - size.height as i32);
    BALL_UNDOCKED.store(true, Ordering::SeqCst);
    glide_ball(app, x, y);
}

/// 球窗自绘拖拽（Rust 轮询鼠标，16ms 跟手）：松手瞬间判定——
/// 位移 ≤5px = 点击展开主窗；超过 = 拖拽完成，立即贴边。
pub fn start_ball_drag(app: AppHandle) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    if BALL_DRAGGING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    // 用户主动按下悬浮球：立即打断正在进行的收球/滑动动画
    BALL_ANIM_GEN.fetch_add(1, Ordering::SeqCst);
    BALL_COLLAPSING.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        let _timer = HighResTimerGuard::new();
        let Some(ball) = app.get_webview_window("ball") else {
            BALL_DRAGGING.store(false, Ordering::SeqCst);
            return;
        };
        let mut start_cur = POINT::default();
        if unsafe { GetCursorPos(&mut start_cur) }.is_err() {
            BALL_DRAGGING.store(false, Ordering::SeqCst);
            return;
        };
        let Ok(start_ball) = ball.outer_position() else {
            BALL_DRAGGING.store(false, Ordering::SeqCst);
            return;
        };
        let offset = (start_ball.x - start_cur.x, start_ball.y - start_cur.y);
        let mut engaged = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(16));
            let mut cur = POINT::default();
            if unsafe { GetCursorPos(&mut cur) }.is_err() || !is_lbutton_down() {
                break;
            };
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
            dock_now(&app);
        } else {
            switch_ball_mode(&app, false);
            let _ = app.emit("state-changed", ());
        }
    });
}

/// 球模式 = 球窗当前可见（switch_ball_mode 是窗口切换唯一权威；db.ball_mode 是
/// 落盘前剥离的临时标记，运行时不维护，不作判据）。
pub fn is_ball_mode(app: &AppHandle) -> bool {
    app.get_webview_window("ball")
        .is_some_and(|b| b.is_visible().unwrap_or(false))
}

/// 「唤起主窗」统一入口（托盘左键 / 托盘菜单 / 单实例二次启动共用）：
/// 球模式下就地展开（球收回、主窗在球位显示），否则照常显示聚焦。
/// 直接 show 主窗会造成主窗与球同屏的双窗 bug。
pub fn show_main(app: &AppHandle) {
    if is_ball_mode(app) {
        switch_ball_mode(app, false);
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// 悬浮球切换（独立球窗口架构）：收球=主窗隐藏+球窗显示（就地出现）；
/// 展开=球窗当前位置显示主窗（尺寸取 pre_ball，按当前显示器边界钳位）。
pub fn switch_ball_mode(app: &AppHandle, on: bool) {
    if is_ball_mode(app) == on {
        return;
    }
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Some(ball) = app.get_webview_window("ball") else {
        return;
    };
    let state = app.state::<AppState>();
    BALL_UNDOCKED.store(false, Ordering::SeqCst);
    let gen = BALL_ANIM_GEN.fetch_add(1, Ordering::SeqCst) + 1;

    if on {
        let pos = main.outer_position().unwrap_or_default();
        // 客户区尺寸入账（outer 含边框补偿且每轮 set_size 复利膨胀，inner 恒定）
        let Ok(csize) = main.inner_size() else {
            return;
        };
        {
            let mut db = state.db.lock().unwrap_or_else(|e| e.into_inner());
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
        let Some(Some(mon)) = main.current_monitor().ok() else {
            return;
        };
        let m = monitor_rect(&mon);
        // 先定位再设逻辑尺寸，确保跨不同 DPI 显示器收球时球窗按主窗所在屏 DPI 缩放
        let _ = ball.set_position(PhysicalPosition::new(pos.x, pos.y));
        let _ = ball.set_size(tauri::LogicalSize::new(BALL_SIZE as f64, BALL_SIZE as f64));
        let real = ball.outer_size().unwrap_or_default();
        let (rw, rh) = (real.width.max(1), real.height.max(1));
        let (edge_x, edge_y) = (
            if pos.x + rw as i32 / 2 < m.0 + m.2 as i32 / 2 {
                m.0
            } else {
                m.0 + m.2 as i32 - rw as i32
            },
            pos.y.clamp(m.1, m.1 + m.3 as i32 - rh as i32),
        );
        let (dock_x, dock_y) = dock_target(m, (edge_x, edge_y, rw, rh));
        BALL_COLLAPSING.store(true, Ordering::SeqCst);
        let _ = ball.show();
        let _ = main.hide();
        wake_ball_watcher();

        // 收球两段动画（时间插值 8ms 一拍，受 BALL_ANIM_GEN 保护）
        let ball2 = ball.clone();
        std::thread::spawn(move || {
            #[cfg(target_os = "windows")]
            let _timer = HighResTimerGuard::new();
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
                if BALL_ANIM_GEN.load(Ordering::SeqCst) != gen {
                    break;
                }
                let p = (t0.elapsed().as_secs_f64() / TOTAL.as_secs_f64()).min(1.0);
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
            BALL_COLLAPSING.store(false, Ordering::SeqCst);
        });
    } else {
        BALL_COLLAPSING.store(false, Ordering::SeqCst);
        let ball_pos = ball.outer_position().unwrap_or_default();
        let target = {
            let db = state.db.lock().unwrap_or_else(|e| e.into_inner());
            match db.pre_ball {
                Some(pre) if pre.width >= MIN_VALID_W && pre.height >= MIN_VALID_H => {
                    (pre.width, pre.height)
                }
                _ => (DEFAULT_W, DEFAULT_H),
            }
        };
        let _ = main.set_size(tauri::PhysicalSize::new(target.0, target.1));
        if let Ok(Some(monitor)) = ball.current_monitor() {
            let (x, y) = clamp_expand_pos(monitor_rect(&monitor), (ball_pos.x, ball_pos.y), target);
            let _ = main.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = main.set_position(PhysicalPosition::new(ball_pos.x, ball_pos.y));
        }
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
        let _ = ball.hide();
        {
            let mut db = state.db.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(w) = db.window.as_mut() {
                w.ball_mode = false;
            }
            db.pre_ball = None;
        }
    }
}

/// 贴边目标位置（纯函数，单测对象）：水平就近选边，垂直原位钳屏内；
/// 露 55% 左右、藏 DOCK_HIDDEN_RATIO 出屏。monitor/ball 均为物理像素全局坐标。
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

/// 球窗平滑滑向目标（8ms 时间插值 ease-out 220ms）。并发调用由 BALL_ANIM_GEN 自动接管。
pub fn glide_ball(app: &AppHandle, tx: i32, ty: i32) {
    let Some(ball) = app.get_webview_window("ball") else {
        return;
    };
    let Ok(from) = ball.outer_position() else {
        return;
    };
    let gen = BALL_ANIM_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let dx = tx - from.x;
    let dy = ty - from.y;
    if dx == 0 && dy == 0 {
        return;
    }
    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        let _timer = HighResTimerGuard::new();
        const TOTAL: std::time::Duration = std::time::Duration::from_millis(220);
        let t0 = std::time::Instant::now();
        loop {
            if BALL_ANIM_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            let p = (t0.elapsed().as_secs_f64() / TOTAL.as_secs_f64()).min(1.0);
            let ease = 1.0 - (1.0 - p) * (1.0 - p);
            let _ = ball.set_position(PhysicalPosition::new(
                from.x + (dx as f64 * ease).round() as i32,
                from.y + (dy as f64 * ease).round() as i32,
            ));
            if p >= 1.0 || !ball.is_visible().unwrap_or(false) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(8));
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
            // 最小化(-32000,-32000,0,0)或不可见状态绝不覆盖有效窗口记忆
            if !win.is_visible().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
                continue;
            }
            let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) else {
                continue;
            };
            if size.width < MIN_VALID_W || size.height < MIN_VALID_H {
                continue;
            }
            persist_geometry(&handle, (pos.x, pos.y), (size.width, size.height));
        }
    });
}

/// 只更新几何，其余字段（置顶、透明度）保留现值，避免拖动把它们冲掉。
/// 球模式下跳过：球的 56px 几何绝不能覆盖展开态记忆（F6）。
fn persist_geometry(handle: &AppHandle, pos: (i32, i32), size: (u32, u32)) {
    let state = handle.state::<AppState>();
    {
        let mut db = state.db.lock().unwrap_or_else(|e| e.into_inner());
        if db.window.map_or(false, |w| w.ball_mode) {
            return;
        }
        let mut ws = db.window.unwrap_or_default();
        ws.x = pos.0;
        ws.y = pos.1;
        ws.width = size.0;
        ws.height = size.1;
        db.window = Some(ws);
    }
    if let Err(e) = crate::store::save_latest(&state.db, &state.path) {
        crate::logging::log_line(&format!("窗口几何落盘失败：{e}"));
        eprintln!("窗口几何落盘失败：{e}");
    }
}

#[cfg(test)]
mod tests {
    use super::{clamp_expand_pos, dock_target, is_rect_on_any_monitor};

    const MON: (i32, i32, u32, u32) = (0, 0, 1920, 1080);
    const BALL: (i32, i32, u32, u32) = (900, 500, 56, 56);

    #[test]
    fn dock_picks_nearest_horizontal_edge() {
        let (x, _) = dock_target(MON, (100, 500, 56, 56));
        assert_eq!(x, -25, "左贴：藏 45% 出左屏（56*0.45≈25）");
        let (x, _) = dock_target(MON, (1700, 500, 56, 56));
        assert_eq!(x, 1920 - 56 + 25, "右贴：藏 45% 出右屏");
    }

    #[test]
    fn dock_keeps_y_clamped_in_monitor() {
        let (x, y) = dock_target(MON, (100, -30, 56, 56));
        assert_eq!((x, y), (-25, 0), "越出屏顶 → 钳回 0");
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
        let sec: (i32, i32, u32, u32) = (1920, 0, 1920, 1080);
        let (x, _) = dock_target(sec, (2600, 500, 56, 56));
        assert_eq!(x, 1920 - 25, "副屏左贴以副屏原点为基准");
    }

    #[test]
    fn expand_clamps_on_secondary_and_negative_monitors() {
        // 副屏在左侧 (-1920..0)：球贴最左边，展开主窗必须在 -1920 起而非跳回 0
        let left_sec: (i32, i32, u32, u32) = (-1920, 0, 1920, 1080);
        assert_eq!(
            clamp_expand_pos(left_sec, (-1945, 300), (300, 520)),
            (-1920, 300)
        );
        // 副屏在右侧 (1920..3840)：球贴最右边，展开主窗贴副屏右缘 (3840 - 300)
        let right_sec: (i32, i32, u32, u32) = (1920, 100, 1920, 1080);
        assert_eq!(
            clamp_expand_pos(right_sec, (3815, 900), (300, 520)),
            (3540, 660)
        );
    }

    #[test]
    fn offscreen_detection_catches_disconnected_monitors_and_minimized_coords() {
        let monitors = [MON];
        assert!(is_rect_on_any_monitor((1500, 100, 300, 520), &monitors));
        assert!(
            !is_rect_on_any_monitor((2200, 100, 300, 520), &monitors),
            "已拔除副屏的坐标需判定离屏"
        );
        assert!(
            !is_rect_on_any_monitor((-32000, -32000, 300, 520), &monitors),
            "Windows 最小化坐标需判定离屏"
        );
    }
}
