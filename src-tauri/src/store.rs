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
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(db).map_err(io::Error::other)?;
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
}
