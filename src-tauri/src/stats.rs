//! 统计：全部纯函数、只读 Database。口径：
//! - 今日概览：done 数 / 当日应呈现任务数（实时状态）
//! - 三类完成率：每日=当日应做全部已勾→100%；限时/不限时=当日该类 done 占比；None=无该类任务
//! - streak：每日任务连续全勾天数（含今天进行中）；无每日任务=None；昨天未全勾则归零
//! - 趋势：daily_log 最近 30 天的每日 done/total

use std::collections::HashMap;

use chrono::NaiveDate;
use serde::Serialize;

use crate::todo::{Database, Kind};

#[derive(Debug, Clone, Serialize)]
pub struct TrendDay {
    pub date: NaiveDate,
    pub done: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatsDto {
    pub today_done: u32,
    pub today_total: u32,
    /// None = 无该类任务（与 0% 语义不同）
    pub rate_daily: Option<f32>,
    pub rate_limited: Option<f32>,
    pub rate_open: Option<f32>,
    /// None = 无每日任务
    pub streak: Option<u32>,
    pub trend: Vec<TrendDay>,
    pub archive_count: u32,
}

pub fn compute_stats(db: &Database, today: NaiveDate) -> StatsDto {
    let today_total = db.tasks.len() as u32;
    let today_done = db.tasks.iter().filter(|t| t.done_date.is_some()).count() as u32;

    let rate = |kind: Kind| -> Option<f32> {
        let tasks: Vec<&crate::todo::Task> =
            db.tasks.iter().filter(|t| t.kind == kind).collect();
        if tasks.is_empty() {
            None
        } else {
            Some(
                tasks.iter().filter(|t| t.done_date.is_some()).count() as f32 / tasks.len() as f32,
            )
        }
    };

    let streak = compute_streak(db, today);
    let trend = compute_trend(db, today, 30);

    StatsDto {
        today_done,
        today_total,
        rate_daily: rate(Kind::Daily),
        rate_limited: rate(Kind::Limited),
        rate_open: rate(Kind::Open),
        streak,
        trend,
        archive_count: db.archive.len() as u32,
    }
}

/// streak：从今天往回走——今天按实时状态算（进行中也算一天，未全勾不计入已完成数但不断链？
/// 口径定为：今天未全勾 = streak 以「昨天为止的连续数」呈现；昨天及更早按 daily_log）。
/// 无每日任务 → None；日志中任一前置日未全勾 → 从该日起归零。
pub fn compute_streak(db: &Database, today: NaiveDate) -> Option<u32> {
    let daily_exists_now = db.tasks.iter().any(|t| t.kind == Kind::Daily);
    if !daily_exists_now && db.daily_log.is_empty() {
        return None;
    }

    // 今天的实时状态
    let today_done = db
        .tasks
        .iter()
        .filter(|t| t.kind == Kind::Daily && t.done_date.is_some())
        .count();
    let today_total = db
        .tasks
        .iter()
        .filter(|t| t.kind == Kind::Daily)
        .count();
    if today_total == 0 {
        return None;
    }

    // 逐日往回重放：map(date -> (done, total))
    let mut by_date: HashMap<NaiveDate, (usize, usize)> = HashMap::new();
    for e in &db.daily_log {
        by_date.insert(e.date, (e.done_ids.len(), e.total_ids.len()));
    }

    let mut streak = 0u32;
    let mut day = today;
    // 今天：进行中全勾才计入；未全勾时 streak 停在「昨天为止的连续数」
    if today_done == today_total {
        streak += 1;
    }
    loop {
        day = day.pred_opt()?;
        match by_date.get(&day) {
            Some((done, total)) if *total > 0 && done == total => streak += 1,
            Some(_) => break,
            None => break, // 没有更早的日志（含开始使用之前），到此为止
        }
    }
    Some(streak)
}

fn compute_trend(db: &Database, today: NaiveDate, days: u32) -> Vec<TrendDay> {
    let mut by_date: HashMap<NaiveDate, (u32, u32)> = HashMap::new();
    for e in &db.daily_log {
        by_date.insert(e.date, (e.done_ids.len() as u32, e.total_ids.len() as u32));
    }
    let mut out = Vec::new();
    let mut day = today;
    for _ in 0..days {
        let entry = match by_date.get(&day) {
            Some((done, total)) => TrendDay {
                date: day,
                done: *done,
                total: *total,
            },
            None => TrendDay {
                date: day,
                done: 0,
                total: 0,
            },
        };
        out.push(entry);
        match day.pred_opt() {
            Some(d) => day = d,
            None => break,
        }
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::todo::{add_task, new_database, roll_over, toggle_done, DailyLogEntry, Kind};
    use chrono::NaiveDate;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    // ── C2/C3 概览与三类完成率 ────────────────────
    #[test]
    fn c2_c3_summary_and_kind_rates_with_none_semantics() {
        let mut db = new_database();
        let daily = add_task(&mut db, d(2026, 9, 24), "每日A", Kind::Daily, None).unwrap();
        add_task(&mut db, d(2026, 9, 24), "每日B", Kind::Daily, None).unwrap();
        let lim = add_task(&mut db, d(2026, 9, 24), "限时", Kind::Limited, Some(d(2026, 9, 30)))
            .unwrap();
        add_task(&mut db, d(2026, 9, 24), "不限时", Kind::Open, None).unwrap();
        toggle_done(&mut db, d(2026, 9, 24), &daily).unwrap();
        toggle_done(&mut db, d(2026, 9, 24), &lim).unwrap();

        let s = compute_stats(&db, d(2026, 9, 24));
        assert_eq!(s.today_total, 4);
        assert_eq!(s.today_done, 2);
        assert_eq!(s.rate_daily, Some(0.5));
        assert_eq!(s.rate_limited, Some(1.0));
        assert_eq!(s.rate_open, Some(0.0), "存在但未勾 = 0%，不是 None");
        assert_eq!(s.streak, Some(0), "今天未全勾且无历史 → 0 天（有每日任务，不是 None）");

        // 无该类 = None
        let mut db2 = new_database();
        add_task(&mut db2, d(2026, 9, 24), "只有不限时", Kind::Open, None).unwrap();
        let s2 = compute_stats(&db2, d(2026, 9, 24));
        assert_eq!(s2.rate_daily, None);
        assert_eq!(s2.rate_limited, None);
        assert_eq!(s2.rate_open, Some(0.0));
    }

    // ── C4 streak 三形态 ─────────────────────────
    #[test]
    fn c4_streak_running_yesterday_full_today_in_progress() {
        let mut db = new_database();
        let id = add_task(&mut db, d(2026, 9, 20), "刷题", Kind::Daily, None).unwrap();
        // 20、21、22 全勾，跨天生成日志
        for day in [20, 21, 22] {
            toggle_done(&mut db, d(2026, 9, day), &id).unwrap();
            roll_over(&mut db, d(2026, 9, day + 1));
        }
        // 23 日进行中（未勾）
        let s = compute_stats(&db, d(2026, 9, 23));
        assert_eq!(s.streak, Some(3), "昨天为止连续 3 天，今天进行中不加分不断链");
    }

    #[test]
    fn c4_streak_break_resets_to_zero() {
        let mut db = new_database();
        let id = add_task(&mut db, d(2026, 9, 20), "刷题", Kind::Daily, None).unwrap();
        for day in [20, 21, 22] {
            toggle_done(&mut db, d(2026, 9, day), &id).unwrap();
            roll_over(&mut db, d(2026, 9, day + 1));
        }
        // 23 日没勾就跨到 24 → 断
        roll_over(&mut db, d(2026, 9, 24));
        let s = compute_stats(&db, d(2026, 9, 24));
        assert_eq!(s.streak, Some(0), "昨日未全勾 → 归零");
    }

    #[test]
    fn c4_streak_today_full_counts_and_none_without_daily() {
        let mut db = new_database();
        let id = add_task(&mut db, d(2026, 9, 20), "刷题", Kind::Daily, None).unwrap();
        toggle_done(&mut db, d(2026, 9, 24), &id).unwrap();
        let s = compute_stats(&db, d(2026, 9, 24));
        assert_eq!(s.streak, Some(1), "今天全勾（无历史）= 1 天");

        let mut db2 = new_database();
        add_task(&mut db2, d(2026, 9, 24), "不限时", Kind::Open, None).unwrap();
        assert_eq!(compute_stats(&db2, d(2026, 9, 24)).streak, None);
    }

    // ── C5 纯函数无副作用 ─────────────────────────
    #[test]
    fn c5_compute_stats_is_pure() {
        let mut db = new_database();
        add_task(&mut db, d(2026, 9, 24), "t", Kind::Daily, None).unwrap();
        let before = format!("{:?}", db);
        let _ = compute_stats(&db, d(2026, 9, 24));
        let _ = compute_stats(&db, d(2026, 9, 24));
        assert_eq!(before, format!("{:?}", db), "统计不得改动任何状态");
    }

    // ── C6 趋势取最近 30 天 ──────────────────────
    #[test]
    fn c6_trend_uses_latest_30_days() {
        let mut db = new_database();
        // 手工构造 35 天日志
        for i in 0..35 {
            let date = NaiveDate::from_ymd_opt(2026, 8, 1)
                .unwrap()
                .checked_add_signed(chrono::Duration::days(i))
                .unwrap();
            db.daily_log.push(DailyLogEntry {
                date,
                done_ids: vec!["a".into(); (i % 3) as usize],
                total_ids: vec!["a".into(); 2],
            });
        }
        let s = compute_stats(&db, d(2026, 9, 4)); // 9/4 往回 30 天 = 8/6..9/4
        assert_eq!(s.trend.len(), 30);
        assert_eq!(s.trend[0].date, d(2026, 8, 6));
        assert_eq!(s.trend[29].date, d(2026, 9, 4));
        // 8/6 是第 6 天（i=5）：done = 5%3=2
        assert_eq!((s.trend[0].done, s.trend[0].total), (2, 2));
        assert_eq!(s.archive_count, 0);
    }
}
