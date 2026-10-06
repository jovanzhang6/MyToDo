//! JSON 原子持久化：临时文件 + rename，绝不留下半截数据文件。

use std::fs;
use std::io;
use std::path::Path;

use crate::todo::Database;

pub fn load(path: &Path) -> io::Result<Database> {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(db) => Ok(db),
            Err(e) => {
                // 数据文件损坏：备份原件后从空库开始，绝不覆盖用户的原始数据
                let backup = path.with_extension(format!(
                    "json.corrupt-{}",
                    chrono::Local::now().format("%Y%m%d-%H%M%S")
                ));
                let _ = fs::rename(path, backup);
                Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("数据文件损坏（已备份）：{e}"),
                ))
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(crate::todo::new_database()),
        Err(e) => Err(e),
    }
}

pub fn save(db: &Database, path: &Path) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    // 悬浮球是临时态：落盘前剥离（强杀/重启后必为展开态，F6）
    let mut persisted = db.clone();
    if persisted.window.as_ref().map_or(false, |w| w.ball_mode) {
        if let Some(w) = persisted.window.as_mut() {
            w.ball_mode = false;
        }
        persisted.pre_ball = None;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(&persisted).map_err(io::Error::other)?;
    fs::write(&tmp, raw)?;
    // Windows 上 std::fs::rename 使用 MOVEFILE_REPLACE_EXISTING，可覆盖已存在文件
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::todo::{add_task, new_database, Kind, SCHEMA_VERSION};

    fn today() -> chrono::NaiveDate {
        chrono::NaiveDate::from_ymd_opt(2026, 9, 24).unwrap()
    }

    // ── B10 持久化 ───────────────────────────────
    #[test]
    fn b10_roundtrip_preserves_chinese_and_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        let mut db = new_database();
        add_task(&mut db, today(), "刷题 ✅ 中文 emoji", Kind::Daily, None).unwrap();
        save(&db, &path).unwrap();

        let loaded = load(&path).unwrap();
        assert_eq!(loaded.tasks.len(), 1);
        assert_eq!(loaded.tasks[0].text, "刷题 ✅ 中文 emoji");
        assert_eq!(loaded.schema_version, SCHEMA_VERSION);
        assert_eq!(loaded.tasks, db.tasks);
    }

    #[test]
    fn b10_save_overwrites_and_leaves_no_tmp() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        save(&new_database(), &path).unwrap();
        save(&new_database(), &path).unwrap();
        let entries: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(entries.len(), 1, "只应有 data.json，不得残留 .tmp");
    }

    #[test]
    fn b10_load_missing_returns_fresh_db() {
        let dir = tempfile::tempdir().unwrap();
        let db = load(&dir.path().join("none.json")).unwrap();
        assert_eq!(db.tasks.len(), 0);
        assert_eq!(db.schema_version, SCHEMA_VERSION);
    }

    // ── 时刻粒度字段（2026-10-06）：新字段 serde default 双向兼容 ──
    #[test]
    fn b11_roundtrip_preserves_due_time_and_stage() {
        use crate::todo::add_task_with_time;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        let mut db = new_database();
        add_task_with_time(
            &mut db,
            today(),
            "带时刻",
            Kind::Limited,
            Some(today().succ_opt().unwrap()),
            Some(chrono::NaiveTime::from_hms_opt(18, 30, 0).unwrap()),
        )
        .unwrap();
        db.tasks[0].notified_stage = 1;
        save(&db, &path).unwrap();

        let loaded = load(&path).unwrap();
        assert_eq!(loaded.tasks[0].due_time, Some(chrono::NaiveTime::from_hms_opt(18, 30, 0).unwrap()));
        assert_eq!(loaded.tasks[0].notified_stage, 1);
        assert_eq!(loaded.tasks, db.tasks);
    }

    #[test]
    fn b11_old_json_without_time_fields_loads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        // 模拟升级前的 v1 数据文件：无 due_time / notified_stage / schema_version=1
        let legacy = format!(
            r#"{{
                "schema_version": 1,
                "last_active_date": "2026-09-24",
                "tasks": [
                    {{"id": "t1", "text": "旧任务", "kind": "limited",
                      "due_date": "2026-09-26", "created_date": "2026-09-24"}}
                ],
                "archive": []
            }}"#
        );
        std::fs::write(&path, legacy).unwrap();
        let db = load(&path).unwrap();
        assert_eq!(db.tasks.len(), 1);
        assert_eq!(db.tasks[0].due_time, None, "旧数据无时刻");
        assert_eq!(db.tasks[0].notified_stage, 0, "旧数据无提醒记账");
        assert_eq!(db.tasks[0].due_date, Some(chrono::NaiveDate::from_ymd_opt(2026, 9, 26).unwrap()));
    }

    // ── 悬浮球态不落盘（F6） ──────────────────────
    #[test]
    fn ball_mode_is_stripped_on_save() {
        use crate::todo::{Database, WindowState};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        let mut db = Database {
            window: Some(WindowState {
                x: 100,
                y: 200,
                width: 56,
                height: 56,
                always_on_top: true,
                opacity: Some(0.35),
                ball_mode: true,
            }),
            pre_ball: Some(WindowState {
                x: 10,
                y: 20,
                width: 300,
                height: 520,
                always_on_top: true,
                opacity: None,
                ball_mode: false,
            }),
            ..new_database()
        };
        add_task(&mut db, today(), "任务", Kind::Open, None).unwrap();
        save(&db, &path).unwrap();
        let loaded = load(&path).unwrap();
        let w = loaded.window.unwrap();
        assert!(!w.ball_mode, "球态不落盘");
        assert!(loaded.pre_ball.is_none(), "pre_ball 一并剥离");
        assert_eq!((w.x, w.y, w.width, w.height), (100, 200, 56, 56));
        assert_eq!(w.opacity, Some(0.35), "其余字段原样保留");
        assert_eq!(loaded.tasks.len(), 1);
    }
}
