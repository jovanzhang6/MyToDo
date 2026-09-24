//! 到期提醒：判断逻辑纯函数化（可单测），toast 发送是薄壳。
//! 约定：同一天至多一条聚合 toast；`last_notified_date` 是去重依据。

use chrono::NaiveDate;
use serde::Serialize;

use crate::todo::Database;

#[derive(Debug, PartialEq)]
pub enum DueDecision {
    /// 今天已提醒过 / 提醒关闭 / 无到期任务 → 不发
    Skip,
    /// 发一条聚合提醒，携带前 3 个任务名
    Notify(Vec<String>),
}

pub fn due_decision(db: &Database, today: NaiveDate) -> DueDecision {
    if !db.reminders_enabled {
        return DueDecision::Skip;
    }
    if db.last_notified_date == Some(today) {
        return DueDecision::Skip;
    }
    let names: Vec<String> = db
        .tasks
        .iter()
        .filter(|t| t.kind == crate::todo::Kind::Limited && t.due_date == Some(today))
        .map(|t| t.text.clone())
        .collect();
    if names.is_empty() {
        DueDecision::Skip
    } else {
        DueDecision::Notify(names)
    }
}

/// 通知正文：N 件到期，列前 3 个任务名。
pub fn due_body(names: &[String]) -> String {
    let mut s = format!("今天有 {} 件任务到期", names.len());
    if names.len() <= 3 {
        s.push_str("：");
        s.push_str(&names.join("、"));
    } else {
        s.push_str(&format!("：{} 等", names.iter().take(3).cloned().collect::<Vec<_>>().join("、")));
    }
    s
}

#[derive(Debug, Clone, Serialize)]
pub struct DueToast {
    pub title: String,
    pub body: String,
}

pub fn build_toast(names: &[String]) -> DueToast {
    DueToast {
        title: "MyToDo · 任务到期".to_string(),
        body: due_body(names),
    }
}

/// 发送 + 记账（幂等由调用方保证只在 decision=Notify 时调用）。
pub fn send_and_mark(app: &tauri::AppHandle, db: &mut Database, today: NaiveDate, names: &[String]) {
    use tauri_plugin_notification::NotificationExt;
    let toast = build_toast(names);
    let _ = app
        .notification()
        .builder()
        .title(toast.title)
        .body(toast.body)
        .show();
    db.last_notified_date = Some(today);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::todo::{add_task, new_database, Kind};
    use chrono::NaiveDate;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    // ── D1：今日到期未提醒 → Notify ───────────────
    #[test]
    fn d1_due_today_notifies_with_names() {
        let mut db = new_database();
        add_task(&mut db, d(2026, 9, 24), "交报告", Kind::Limited, Some(d(2026, 9, 26))).unwrap();
        add_task(&mut db, d(2026, 9, 24), "交作业", Kind::Limited, Some(d(2026, 9, 26))).unwrap();
        assert_eq!(
            due_decision(&db, d(2026, 9, 26)),
            DueDecision::Notify(vec!["交报告".into(), "交作业".into()])
        );
        assert_eq!(due_body(&["交报告".into(), "交作业".into()]), "今天有 2 件任务到期：交报告、交作业");
    }

    // ── D2：同日去重 / 次日新任务再提醒 ─────────────
    #[test]
    fn d2_same_day_dedup_next_day_fresh() {
        let mut db = new_database();
        add_task(&mut db, d(2026, 9, 24), "A", Kind::Limited, Some(d(2026, 9, 26))).unwrap();
        assert!(matches!(due_decision(&db, d(2026, 9, 26)), DueDecision::Notify(_)));
        db.last_notified_date = Some(d(2026, 9, 26));
        assert_eq!(due_decision(&db, d(2026, 9, 26)), DueDecision::Skip, "同日不轰炸");
        assert_eq!(due_decision(&db, d(2026, 9, 27)), DueDecision::Skip, "无新到期也不发");
        add_task(&mut db, d(2026, 9, 26), "B", Kind::Limited, Some(d(2026, 9, 27))).unwrap();
        assert!(matches!(due_decision(&db, d(2026, 9, 27)), DueDecision::Notify(_)));
    }

    // ── D3：无到期 / 开关关闭 → 零打扰 ─────────────
    #[test]
    fn d3_no_due_or_disabled_means_silence() {
        let mut db = new_database();
        add_task(&mut db, d(2026, 9, 24), "不限时", Kind::Open, None).unwrap();
        add_task(&mut db, d(2026, 9, 24), "每日", Kind::Daily, None).unwrap();
        assert_eq!(due_decision(&db, d(2026, 9, 26)), DueDecision::Skip);

        add_task(&mut db, d(2026, 9, 24), "到期A", Kind::Limited, Some(d(2026, 9, 26))).unwrap();
        db.reminders_enabled = false;
        assert_eq!(due_decision(&db, d(2026, 9, 26)), DueDecision::Skip, "总开关关闭");
    }

    #[test]
    fn d1_body_lists_first_three_when_many() {
        let names: Vec<String> = ["一", "二", "三", "四"].iter().map(|s| s.to_string()).collect();
        assert_eq!(due_body(&names), "今天有 4 件任务到期：一、二、三 等");
    }
}
