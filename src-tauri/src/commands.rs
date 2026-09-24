//! Tauri 命令层：取本地日期 → 引擎 → 落盘 → 广播。业务规则一概不在这里。

use std::sync::Mutex;

use chrono::{Local, NaiveDate};
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

#[derive(Serialize)]
pub struct StateDto {
    pub today: NaiveDate,
    pub tasks: Vec<TaskView>,
    pub always_on_top: bool,
    pub glass_opacity: f32,
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
    let changed = todo::roll_over(&mut db, today());
    let dto = StateDto {
        today: today(),
        tasks: todo::build_view(&db, today()),
        always_on_top: todo::always_on_top(&db),
        glass_opacity: db.window.and_then(|w| w.opacity).unwrap_or(0.5),
    };
    drop(db);
    finalize(&app, &state, changed)?;
    Ok(dto)
}

#[tauri::command]
pub fn add_task(
    app: AppHandle,
    text: String,
    kind: Kind,
    due_date: Option<NaiveDate>,
) -> Result<String, String> {
    let state = app.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    let result = todo::add_task(&mut db, today(), &text, kind, due_date);
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
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    let result = todo::set_kind(&mut db, &id, kind, due_date);
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
