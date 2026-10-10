//! 到期提醒：判断逻辑纯函数化（可单测），toast 发送是薄壳。
//! 约定（2026-10-06 时刻粒度改版）：未完成限时任务在到期前 1 小时、15 分钟各提醒一次，
//! 按任务按段记账（Task.notified_stage）防重发；同一轮询窗口内同段任务聚合为一条 toast。

use chrono::{NaiveDate, NaiveDateTime};
use serde::Serialize;

use crate::todo::{Database, Kind, Task, due_datetime};

/// 提醒阶段：0 未发 / 1 已发提前 1 小时 / 2 已发提前 15 分钟（编码即紧急度，取 max 补偿跳段）
pub const STAGE_NONE: u8 = 0;
pub const STAGE_T60: u8 = 1;
pub const STAGE_T15: u8 = 2;

/// 单段待发提醒：同段任务聚合（names 供文案，task_ids 供记账）
#[derive(Debug, PartialEq)]
pub struct StageNotice {
    pub stage: u8,
    pub names: Vec<String>,
    pub task_ids: Vec<String>,
}

/// 单任务判定：现在是否该给它发提醒（跳过已完成/非限时/已发过/已到期）。
pub fn reminder_stage(t: &Task, now: NaiveDateTime) -> Option<u8> {
    if t.kind != Kind::Limited || t.done_date.is_some() {
        return None;
    }
    let due = due_datetime(t)?;
    let minutes_left = (due - now).num_minutes();
    if minutes_left <= 0 {
        return None; // 已到期：交给 expire_now 归档，不发提醒
    }
    let crossed = if minutes_left <= 15 {
        STAGE_T15
    } else if minutes_left <= 60 {
        STAGE_T60
    } else {
        STAGE_NONE
    };
    if crossed > t.notified_stage {
        Some(crossed)
    } else {
        None
    }
}

/// 全库判定：把该发的提醒按段聚合；更紧迫的段排前面（休眠唤醒后可能多段同发）。
pub fn reminder_decision(db: &Database, now: NaiveDateTime) -> Vec<StageNotice> {
    if !db.reminders_enabled {
        return Vec::new();
    }
    let mut out: Vec<StageNotice> = Vec::new();
    for t in &db.tasks {
        if let Some(stage) = reminder_stage(t, now) {
            match out.iter_mut().find(|s| s.stage == stage) {
                Some(s) => {
                    s.names.push(t.text.clone());
                    s.task_ids.push(t.id.clone());
                }
                None => out.push(StageNotice {
                    stage,
                    names: vec![t.text.clone()],
                    task_ids: vec![t.id.clone()],
                }),
            }
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.stage));
    out
}

#[derive(Debug, Clone, Serialize)]
pub struct DueToast {
    pub title: String,
    pub body: String,
}

fn stage_label(stage: u8) -> &'static str {
    if stage == STAGE_T15 {
        "15 分钟后"
    } else {
        "1 小时后"
    }
}

/// 通知正文：N 件即将到期，列前 3 个任务名。
pub fn stage_body(stage: u8, names: &[String]) -> String {
    let mut s = format!("{}有 {} 件任务到期", stage_label(stage), names.len());
    if names.len() <= 3 {
        s.push_str("：");
        s.push_str(&names.join("、"));
    } else {
        s.push_str(&format!(
            "：{} 等",
            names.iter().take(3).cloned().collect::<Vec<_>>().join("、")
        ));
    }
    s
}

pub fn build_toast(stage: u8, names: &[String]) -> DueToast {
    DueToast {
        title: "MyToDo · 任务即将到期".to_string(),
        body: stage_body(stage, names),
    }
}

/// 发送 + 记账：把涉及任务标记到对应段（幂等由 reminder_decision 保证只报未发的段）。
pub fn send_stage(app: &tauri::AppHandle, db: &mut Database, notice: &StageNotice) {
    use tauri_plugin_notification::NotificationExt;
    let toast = build_toast(notice.stage, &notice.names);
    let _ = app
        .notification()
        .builder()
        .title(toast.title)
        .body(toast.body)
        .show();
    for id in &notice.task_ids {
        if let Some(t) = db.tasks.iter_mut().find(|t| &t.id == id) {
            t.notified_stage = notice.stage;
        }
    }
}

/* ── 积压提醒：不限时任务躺 ≥backlog_days 天未动，每天至多一条聚合 toast ── */

/// 单日积压待发：件数、最老天数、最积压的前 3 个任务名
#[derive(Debug, PartialEq)]
pub struct BacklogNotice {
    pub count: u32,
    pub oldest_days: u32,
    pub names: Vec<String>,
}

/// 全库判定（口径与 stats 积压告警一致：Open + 未完成 + 躺够阈值天数）。
/// 返回 None = 今天已发 / 开关关闭 / 无积压。
pub fn backlog_decision(db: &Database, today: NaiveDate) -> Option<BacklogNotice> {
    if !db.reminders_enabled {
        return None;
    }
    if db.last_backlog_notified_date == Some(today) {
        return None;
    }
    let mut aged: Vec<(NaiveDate, u32, String)> = db
        .tasks
        .iter()
        .filter(|t| t.kind == Kind::Open && t.done_date.is_none())
        .map(|t| {
            (
                t.created_date,
                (today - t.created_date).num_days().max(0) as u32,
                t.text.clone(),
            )
        })
        .filter(|(_, age, _)| *age >= db.backlog_days)
        .collect();
    if aged.is_empty() {
        return None;
    }
    aged.sort();
    let oldest_days = aged.iter().map(|(_, age, _)| *age).max().unwrap_or(0);
    Some(BacklogNotice {
        count: aged.len() as u32,
        oldest_days,
        names: aged.into_iter().take(3).map(|(_, _, name)| name).collect(),
    })
}

/// 通知正文：与统计页积压横幅同一语气。
pub fn backlog_body(notice: &BacklogNotice) -> String {
    let mut s = format!(
        "{} 件不限时任务已躺 {} 天——该做掉，或者删掉",
        notice.count, notice.oldest_days
    );
    if !notice.names.is_empty() {
        s.push_str("：");
        s.push_str(&notice.names.join("、"));
        if notice.count > notice.names.len() as u32 {
            s.push_str(" 等");
        }
    }
    s
}

pub fn build_backlog_toast(notice: &BacklogNotice) -> DueToast {
    DueToast {
        title: "MyToDo · 积压提醒".to_string(),
        body: backlog_body(notice),
    }
}

/// 发送 + 记账（幂等由 backlog_decision 保证每天只报一次）。
pub fn send_backlog(
    app: &tauri::AppHandle,
    db: &mut Database,
    today: NaiveDate,
    notice: &BacklogNotice,
) {
    use tauri_plugin_notification::NotificationExt;
    let toast = build_backlog_toast(notice);
    let _ = app
        .notification()
        .builder()
        .title(toast.title)
        .body(toast.body)
        .show();
    db.last_backlog_notified_date = Some(today);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::todo::{add_task, add_task_with_time, expire_now, new_database, toggle_done};
    use chrono::NaiveDate;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }
    fn dt(day: u32, h: u32, min: u32) -> NaiveDateTime {
        d(2026, 9, day).and_hms_opt(h, min, 0).unwrap()
    }

    /// 截止 9月26日 17:00 的限时任务
    fn due_db() -> Database {
        let mut db = new_database();
        add_task_with_time(
            &mut db,
            d(2026, 9, 24),
            "交报告",
            Kind::Limited,
            Some(d(2026, 9, 26)),
            chrono::NaiveTime::from_hms_opt(17, 0, 0),
        )
        .unwrap();
        db
    }

    // ── D1：提前 1 小时窗口触发，记账后不重发 ─────────
    #[test]
    fn d1_t60_fires_once_then_silent() {
        let db = due_db();
        assert_eq!(
            reminder_decision(&db, dt(26, 16, 10)),
            vec![StageNotice {
                stage: STAGE_T60,
                names: vec!["交报告".into()],
                task_ids: vec![db.tasks[0].id.clone()],
            }],
            "剩 50 分钟 → 提前 1 小时段"
        );
        assert_eq!(reminder_decision(&db, dt(26, 15, 0)), Vec::new(), "剩 2 小时不发");
    }

    // ── D2：15 分钟段依次触发 + 跨段不重发 ───────────
    #[test]
    fn d2_t15_follows_t60_without_refire() {
        let mut db = due_db();
        // 发过 1 小时段
        let notice = &reminder_decision(&db, dt(26, 16, 10));
        assert_eq!(notice.len(), 1);
        send_marks_only(&mut db, notice);
        assert_eq!(db.tasks[0].notified_stage, STAGE_T60);
        assert_eq!(reminder_decision(&db, dt(26, 16, 20)), Vec::new(), "已发段不重发");

        // 进入 15 分钟窗口
        let notices = reminder_decision(&db, dt(26, 16, 50));
        assert_eq!(notices[0].stage, STAGE_T15, "剩 10 分钟 → 15 分钟段");
        assert_eq!(stage_body(STAGE_T15, &notices[0].names), "15 分钟后有 1 件任务到期：交报告");
    }

    // ── D3：休眠跳段只发最紧迫的一段 ─────────────────
    #[test]
    fn d3_sleep_jump_sends_only_most_urgent() {
        let db = due_db();
        // 一觉从 15:00 睡到 16:55：两个窗口都被跨过 → 只发 15 分钟段
        let notices = reminder_decision(&db, dt(26, 16, 55));
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].stage, STAGE_T15);
        assert_eq!(build_toast(STAGE_T15, &["A".into()]).body, "15 分钟后有 1 件任务到期：A");
        assert_eq!(build_toast(STAGE_T60, &["A".into()]).body, "1 小时后有 1 件任务到期：A");
    }

    // ── D4：已完成 / 非限时 / 开关关闭 / 已到期 → 静默 ─
    #[test]
    fn d4_silent_cases() {
        let mut db = due_db();
        let id = db.tasks[0].id.clone();
        toggle_done(&mut db, d(2026, 9, 25), &id).unwrap();
        assert_eq!(reminder_decision(&db, dt(26, 16, 50)), Vec::new(), "已完成不提醒");

        let mut db2 = due_db();
        db2.reminders_enabled = false;
        assert_eq!(reminder_decision(&db2, dt(26, 16, 50)), Vec::new(), "总开关关闭");

        let mut db3 = due_db();
        assert!(expire_now(&mut db3, dt(26, 17, 0)), "到期时刻即归档");
        assert_eq!(reminder_decision(&db3, dt(26, 17, 1)), Vec::new(), "已到期不提醒");
        assert!(db3.tasks.is_empty());
    }

    // ── D5：旧天粒度任务按 23:59 到期，白天不触发 ─────
    #[test]
    fn d5_legacy_day_task_reminds_late_evening_only() {
        let mut db = new_database();
        crate::todo::add_task(&mut db, d(2026, 9, 24), "旧任务", Kind::Limited, Some(d(2026, 9, 26)))
            .unwrap();
        assert_eq!(reminder_decision(&db, dt(26, 10, 0)), Vec::new(), "距 23:59 尚早");
        let notices = reminder_decision(&db, dt(26, 23, 0));
        assert_eq!(notices[0].stage, STAGE_T60, "23:00 距 23:59 不足 1 小时");
    }

    // ── D6：多任务同段聚合成一条，紧迫段排前 ─────────
    #[test]
    fn d6_aggregates_same_stage_and_orders_urgent_first() {
        let mut db = new_database();
        add_task_with_time(
            &mut db,
            d(2026, 9, 24),
            "甲",
            Kind::Limited,
            Some(d(2026, 9, 26)),
            chrono::NaiveTime::from_hms_opt(17, 0, 0),
        )
        .unwrap();
        add_task_with_time(
            &mut db,
            d(2026, 9, 24),
            "乙",
            Kind::Limited,
            Some(d(2026, 9, 26)),
            chrono::NaiveTime::from_hms_opt(17, 5, 0),
        )
        .unwrap();
        add_task_with_time(
            &mut db,
            d(2026, 9, 24),
            "丙",
            Kind::Limited,
            Some(d(2026, 9, 26)),
            chrono::NaiveTime::from_hms_opt(17, 50, 0),
        )
        .unwrap();
        let notices = reminder_decision(&db, dt(26, 16, 50));
        assert_eq!(notices.len(), 2);
        assert_eq!(notices[0].stage, STAGE_T15, "更紧迫段在前");
        assert_eq!(notices[0].names, vec!["甲".to_string(), "乙".to_string()]);
        assert_eq!(notices[1].stage, STAGE_T60);
        assert_eq!(
            stage_body(STAGE_T15, &notices[0].names),
            "15 分钟后有 2 件任务到期：甲、乙"
        );
    }

    /// 测试用：只记账不发系统通知
    fn send_marks_only(db: &mut Database, notices: &[StageNotice]) {
        for n in notices {
            for id in &n.task_ids {
                if let Some(t) = db.tasks.iter_mut().find(|t| &t.id == id) {
                    t.notified_stage = n.stage;
                }
            }
        }
    }

    /* ── D7 积压提醒 ────────────────────────────── */

    #[test]
    fn d7_backlog_fires_with_oldest_first_names() {
        let mut db = new_database();
        // 两个积压（9/19 创建躺 5 天、9/20 创建躺 4 天）+ 一个年轻（9/23，躺 1 天）
        add_task(&mut db, d(2026, 9, 19), "旧任务A", Kind::Open, None).unwrap();
        add_task(&mut db, d(2026, 9, 20), "旧任务B", Kind::Open, None).unwrap();
        add_task(&mut db, d(2026, 9, 23), "新任务", Kind::Open, None).unwrap();
        let notice = backlog_decision(&db, d(2026, 9, 24)).expect("躺够 3 天应触发");
        assert_eq!(notice.count, 2);
        assert_eq!(notice.oldest_days, 5);
        assert_eq!(notice.names, vec!["旧任务A".to_string(), "旧任务B".to_string()]);
        assert_eq!(
            backlog_body(&notice),
            "2 件不限时任务已躺 5 天——该做掉，或者删掉：旧任务A、旧任务B"
        );
    }

    #[test]
    fn d7_once_per_day_then_fresh_next_day() {
        let mut db = new_database();
        add_task(&mut db, d(2026, 9, 19), "旧任务", Kind::Open, None).unwrap();
        assert!(backlog_decision(&db, d(2026, 9, 24)).is_some());
        db.last_backlog_notified_date = Some(d(2026, 9, 24));
        assert_eq!(backlog_decision(&db, d(2026, 9, 24)), None, "同日不重发");
        assert!(backlog_decision(&db, d(2026, 9, 25)).is_some(), "次日新的一天可再发");
    }

    #[test]
    fn d7_silent_cases() {
        let mut db = new_database();
        // 未达阈值
        add_task(&mut db, d(2026, 9, 23), "年轻任务", Kind::Open, None).unwrap();
        assert_eq!(backlog_decision(&db, d(2026, 9, 24)), None);

        // 已完成 / 限时类型不计数
        add_task(&mut db, d(2026, 9, 19), "做完了", Kind::Open, None).unwrap();
        let done_id = db.tasks[1].id.clone();
        toggle_done(&mut db, d(2026, 9, 20), &done_id).unwrap();
        add_task(
            &mut db,
            d(2026, 9, 19),
            "限时的不算积压",
            Kind::Limited,
            Some(d(2026, 9, 30)),
        )
        .unwrap();
        assert_eq!(backlog_decision(&db, d(2026, 9, 24)), None, "只剩已完成与限时");

        // 开关关闭
        add_task(&mut db, d(2026, 9, 19), "很旧的任务", Kind::Open, None).unwrap();
        db.reminders_enabled = false;
        assert_eq!(backlog_decision(&db, d(2026, 9, 24)), None, "总开关关闭");
    }

    #[test]
    fn d7_body_ellipses_when_many() {
        let notice = BacklogNotice {
            count: 4,
            oldest_days: 7,
            names: vec!["一".into(), "二".into(), "三".into()],
        };
        assert_eq!(
            backlog_body(&notice),
            "4 件不限时任务已躺 7 天——该做掉，或者删掉：一、二、三 等"
        );
    }
}
