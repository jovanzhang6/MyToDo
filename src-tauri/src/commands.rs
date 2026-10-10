//! Tauri 命令层：取本地日期 → 引擎 → 落盘 → 广播。业务规则一概不在这里。

use std::sync::Mutex;

use chrono::{Local, NaiveDate, NaiveDateTime, NaiveTime};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::todo::{self, Database, Kind, TaskView, WindowState};
use crate::tray::TrayHandles;

pub struct AppState {
    pub db: Mutex<Database>,
    pub path: std::path::PathBuf,
}

pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// 引擎纪律「时间一律注入」的注入源：本地 naive 时刻（日期 + 时分秒）。
pub fn now() -> NaiveDateTime {
    Local::now().naive_local()
}

#[derive(Serialize)]
pub struct StateDto {
    pub today: NaiveDate,
    pub tasks: Vec<TaskView>,
    pub always_on_top: bool,
    pub glass_opacity: f32,
    pub reminders_enabled: bool,
    pub backlog_days: u32,
    pub autostart_enabled: bool,
    pub ball_mode: bool,
    pub stats: crate::stats::StatsDto,
}

/// 所有命令共用的推进-落盘-广播三连。引擎幂等，重复调用无害。
fn finalize(app: &AppHandle, state: &AppState, changed: bool) -> Result<(), String> {
    if changed {
        crate::store::save(&state.db.lock().unwrap(), &state.path)
            .map_err(|e| format!("保存失败：{e}"))?;
        app.emit("state-changed", ()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_state(app: AppHandle) -> Result<StateDto, String> {
    let state = app.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    let now = now();
    let today = now.date();
    let mut changed = todo::roll_over(&mut db, today);

    // 时刻级过期 + 到期提醒 + 积压提醒：跨天/唤醒后检查一次；发送与否都随本次落盘
    changed |= todo::expire_now(&mut db, now);
    for notice in crate::notify::reminder_decision(&db, now) {
        crate::notify::send_stage(&app, &mut db, &notice);
        changed = true;
    }
    if let Some(notice) = crate::notify::backlog_decision(&db, today) {
        crate::notify::send_backlog(&app, &mut db, today, &notice);
        changed = true;
    }
    if let Some(notice) = crate::notify::evening_decision(&db, now) {
        crate::notify::send_evening(&app, &mut db, today, &notice);
        changed = true;
    }

    let dto = StateDto {
        today,
        tasks: todo::build_view(&db, today),
        always_on_top: todo::always_on_top(&db),
        ball_mode: db.window.map_or(false, |w| w.ball_mode),
        glass_opacity: db.window.and_then(|w| w.opacity).unwrap_or(0.5),
        reminders_enabled: db.reminders_enabled,
        backlog_days: db.backlog_days,
        autostart_enabled: {
            use tauri_plugin_autostart::ManagerExt;
            app.autolaunch().is_enabled().unwrap_or(false)
        },
        stats: crate::stats::compute_stats(&db, today),
    };
    drop(db);
    finalize(&app, &state, changed)?;
    Ok(dto)
}

/// 解析前端传来的 "HH:MM" 时刻（空串/缺省 = None，天粒度语义）。
fn parse_due_time(due_time: Option<&str>) -> Result<Option<NaiveTime>, String> {
    match due_time.unwrap_or("") {
        "" => Ok(None),
        s => NaiveTime::parse_from_str(s, "%H:%M")
            .map(Some)
            .map_err(|_| "时刻格式应为 HH:MM".to_string()),
    }
}

#[tauri::command]
pub fn add_task(
    app: AppHandle,
    text: String,
    kind: Kind,
    due_date: Option<NaiveDate>,
    due_time: Option<String>,
) -> Result<String, String> {
    let state = app.state::<AppState>();
    let time = parse_due_time(due_time.as_deref())?;
    if kind == Kind::Limited && matches!(due_date, Some(due) if todo::due_in_past(due, time, now())) {
        return Err("这个时间已经过了，选一个未来的时刻".to_string());
    }
    let mut db = state.db.lock().unwrap();
    let result = todo::add_task_with_time(&mut db, today(), &text, kind, due_date, time);
    let changed = result.is_ok();
    drop(db);
    finalize(&app, &state, changed)?;
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_done(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    let result = todo::toggle_done(&mut db, today(), &id);
    let changed = result.is_ok();
    drop(db);
    finalize(&app, &state, changed)?;
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_kind(
    app: AppHandle,
    id: String,
    kind: Kind,
    due_date: Option<NaiveDate>,
    due_time: Option<String>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let time = parse_due_time(due_time.as_deref())?;
    if kind == Kind::Limited && matches!(due_date, Some(due) if todo::due_in_past(due, time, now())) {
        return Err("这个时间已经过了，选一个未来的时刻".to_string());
    }
    let mut db = state.db.lock().unwrap();
    let result = todo::set_kind(&mut db, &id, kind, due_date, time);
    let changed = result.is_ok();
    drop(db);
    finalize(&app, &state, changed)?;
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn edit_text(app: AppHandle, id: String, text: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    let result = todo::edit_text(&mut db, &id, &text);
    let changed = result.is_ok();
    drop(db);
    finalize(&app, &state, changed)?;
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    let result = todo::delete_task(&mut db, today(), &id);
    let changed = result.is_ok();
    drop(db);
    finalize(&app, &state, changed)?;
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_always_on_top(app: AppHandle, window: WebviewWindow, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    let ws = db.window.get_or_insert_with(WindowState::default);
    ws.always_on_top = on;
    drop(db);
    finalize(&app, &state, true)?;
    if let Some(handles) = app.try_state::<TrayHandles>() {
        let _ = handles.pin.set_checked(on);
    }
    Ok(())
}

/// 前端黑匣子：把 JS 侧错误透传到后端日志，便于开发期定位。
#[tauri::command]
pub fn log_frontend(msg: String) {
    eprintln!("[前端] {msg}");
}

/// 打开 GitHub 仓库主页（设置页求 Star 入口）：系统默认浏览器，不污染小窗 WebView。
#[tauri::command]
pub fn open_repo(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://github.com/jovanzhang6/MyToDo", None::<&str>)
        .map_err(|e| format!("打开浏览器失败：{e}"))
}

/// 设置玻璃层不透明度（0.10–0.95）：落盘并即时重涂 Acrylic 材质。
#[tauri::command]
pub fn set_opacity(
    app: AppHandle,
    window: WebviewWindow,
    opacity: f32,
) -> Result<f32, String> {
    let clamped = opacity.clamp(0.10, 0.95);
    let state = app.state::<AppState>();
    {
        let mut db = state.db.lock().unwrap();
        let ws = db.window.get_or_insert_with(Default::default);
        ws.opacity = Some(clamped);
    }
    crate::store::save(&state.db.lock().unwrap(), &state.path)
        .map_err(|e| format!("保存失败：{e}"))?;
    crate::window::apply_blur(&window, clamped);
    Ok(clamped)
}

/// 到期提醒总开关（设置面板）。
#[tauri::command]
pub fn set_reminders_enabled(app: AppHandle, on: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let mut db = state.db.lock().unwrap();
        db.reminders_enabled = on;
    }
    crate::store::save(&state.db.lock().unwrap(), &state.path)
        .map_err(|e| format!("保存失败：{e}"))?;
    // 广播状态变更：设置页的联动灰显等 UI 依赖它即时同步（否则要等窗口焦点触发 refresh）
    app.emit("state-changed", ()).map_err(|e| e.to_string())
}

/// 开机自启开关（设置页；状态以系统注册态为唯一事实源）。
#[tauri::command]
pub fn set_autostart(app: AppHandle, on: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let result = if on {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|e| format!("设置开机自启失败：{e}"))?;
    app.emit("state-changed", ()).map_err(|e| e.to_string())
}

/// 积压告警阈值（1–30 天，越界收敛）。
#[tauri::command]
pub fn set_backlog_days(app: AppHandle, days: u32) -> Result<u32, String> {
    let clamped = days.clamp(1, 30);
    let state = app.state::<AppState>();
    {
        let mut db = state.db.lock().unwrap();
        db.backlog_days = clamped;
    }
    crate::store::save(&state.db.lock().unwrap(), &state.path)
        .map_err(|e| format!("保存失败：{e}"))?;
    app.emit("state-changed", ()).map_err(|e| e.to_string())?;
    Ok(clamped)
}

/// 悬浮球模式切换：委托 switch_ball_mode（独立球窗口架构）。
#[tauri::command]
pub fn set_ball_mode(app: AppHandle, on: bool) -> Result<(), String> {
    crate::window::switch_ball_mode(&app, on);
    // 广播让两个窗口的前端同步（球窗刷新数字，主窗恢复清单）
    app.emit("state-changed", ()).map_err(|e| e.to_string())
}

/// 球窗 mousedown 调用：进入自绘拖拽（松手自动判定点击展开/贴边）。
#[tauri::command]
pub fn start_ball_drag(app: AppHandle) {
    crate::window::start_ball_drag(app);
}

/// 悬停滑出：贴点位 → 同边全可见。
#[tauri::command]
pub fn undock_ball(app: AppHandle) -> Result<(), String> {
    crate::window::undock_now(&app);
    Ok(())
}

/// 悬停移开/松手贴边：滑回贴点位。
#[tauri::command]
pub fn dock_ball(app: AppHandle) -> Result<(), String> {
    crate::window::dock_now(&app);
    Ok(())
}

static HIDE_TIP_SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 关闭按钮 = 隐藏到托盘（应用不退出）；每次运行首次隐藏时给一条系统通知反馈。
#[tauri::command]
pub fn hide_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())?;
    use std::sync::atomic::Ordering;
    if !HIDE_TIP_SHOWN.swap(true, Ordering::Relaxed) {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("MyToDo")
            .body("已隐藏到托盘：点托盘图标可再显示，右键菜单可退出")
            .show();
    }
    Ok(())
}

/// 时分级提醒轮询（30 秒一拍）：窗口隐藏时 WebView2 会节流前端定时器，到期判定必须由
/// Rust 侧驱动。这里只做「锁库 → 纯函数判定 → 发送 → 落盘 → 广播」的薄壳；与 get_state
/// 走同一套判定，Task.notified_stage 阶段标记保证两条路径幂等。
pub fn start_reminder_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        reminder_tick(&app);
    });
}

fn reminder_tick(app: &AppHandle) {
    let state = app.state::<AppState>();
    let now = now();
    let mut changed = false;
    let notices;
    {
        let mut db = state.db.lock().unwrap();
        changed |= todo::roll_over(&mut db, now.date());
        changed |= todo::expire_now(&mut db, now);
        notices = crate::notify::reminder_decision(&db, now);
        for n in &notices {
            crate::notify::send_stage(app, &mut db, n);
        }
        changed |= !notices.is_empty();
        // 积压提醒：与到期提醒同轮询驱动，每天至多一条
        if let Some(notice) = crate::notify::backlog_decision(&db, now.date()) {
            crate::notify::send_backlog(app, &mut db, now.date(), &notice);
            changed = true;
        }
        // 晚间打卡提醒：22:00 后首拍，当日每日任务没勾完提醒一次
        if let Some(notice) = crate::notify::evening_decision(&db, now) {
            crate::notify::send_evening(app, &mut db, now.date(), &notice);
            changed = true;
        }
    }
    if changed {
        if let Err(e) = crate::store::save(&state.db.lock().unwrap(), &state.path) {
            crate::logging::log_line(&format!("提醒轮询落盘失败：{e}"));
            eprintln!("提醒轮询落盘失败：{e}");
        }
        let _ = app.emit("state-changed", ());
    }
}
