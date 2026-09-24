//! 统计：全部纯函数、只读 Database。按 PM 三问组织：
//! ① 今日怎么样 → summary（done/total/remaining）
//! ② 我在坚持吗 → streak（当前+最长）+ 30 天热力图（全任务口径）
//! ③ 管理健康吗 → 按期完成率（限时归档）+ 积压告警（不限时躺 ≥BACKLOG_DAYS 天未动）
//! None 语义 = 前置条件不存在（无该类任务/无每日任务），与 0 是两回事。

use chrono::NaiveDate;
use serde::Serialize;

use crate::todo::{Database, Kind, Outcome};

/// 不限时任务躺够几天算积压（PM 口径：3 天没动就该处理）
const BACKLOG_DAYS: i64 = 3;
const HEATMAP_DAYS: u32 = 30;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HeatDay {
    pub date: NaiveDate,
    pub done: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatsDto {
    // ① 今日
    pub today_done: u32,
    pub today_total: u32,
    // ② 坚持
    /// None = 无每日任务
    pub streak_current: Option<u32>,
    pub streak_longest: Option<u32>,
    pub heatmap: Vec<HeatDay>,
    // ③ 健康
    pub rate_daily: Option<f32>,
    pub rate_limited: Option<f32>,
    pub rate_open: Option<f32>,
    /// 限时任务按期完成率：CompletedOn / (CompletedOn + ExpiredUnfinished)；None = 无限时归档
    pub on_time_rate: Option<f32>,
    /// 积压中的不限时任务数（创建 ≥3 天且未完成）
    pub backlog_count: u32,
    /// 最老积压任务躺了多少天；None = 无积压
    pub oldest_backlog_days: Option<u32>,
}

pub fn compute_stats(db: &Database, today: NaiveDate) -> StatsDto {
    let today_total = db.tasks.len() as u32;
    let today_done = db.tasks.iter().filter(|t| t.done_date.is_some()).count() as u32;

    let rate = |kind: Kind| -> Option<f32> {
        let tasks: Vec<_> = db.tasks.iter().filter(|t| t.kind == kind).collect();
        if tasks.is_empty() {
            None
        } else {
            Some(
                tasks.iter().filter(|t| t.done_date.is_some()).count() as f32 / tasks.len() as f32,
            )
        }
    };

    let (streak_current, streak_longest) = streaks(db, today);

    // 按期完成率（限时归档）
    let limited_archive: Vec<_> = db
        .archive
        .iter()
        .filter(|a| a.task.kind == Kind::Limited)
        .collect();
    let on_time = limited_archive
        .iter()
        .filter(|a| a.outcome == Outcome::CompletedOn)
        .count();
    let on_time_rate = if limited_archive.is_empty() {
        None
    } else {
        Some(on_time as f32 / limited_archive.len() as f32)
    };

    // 积压：不限时、未完成、创建 ≥3 天
    let backlog: Vec<u32> = db
        .tasks
        .iter()
        .filter(|t| t.kind == Kind::Open && t.done_date.is_none())
        .map(|t| (today - t.created_date).num_days().max(0) as u32)
        .filter(|age| *age as i64 >= BACKLOG_DAYS)
        .collect();
    let oldest_backlog_days = backlog.iter().max().copied();

    StatsDto {
        today_done,
        today_total,
        streak_current,
        streak_longest,
        heatmap: heatmap(db, today, HEATMAP_DAYS),
        rate_daily: rate(Kind::Daily),
        rate_limited: rate(Kind::Limited),
        rate_open: rate(Kind::Open),
        on_time_rate,
        backlog_count: backlog.len() as u32,
        oldest_backlog_days,
    }
}

/// （当前连续，最长纪录）。当前：今天全勾→含今天往回；今天没全勾→从昨天往回。
/// 最长：全历史（含今天）里连续全勾的最长一段。
fn streaks(db: &Database, today: NaiveDate) -> (Option<u32>, Option<u32>) {
    let mut by_date: std::collections::HashMap<NaiveDate, (u32, u32)> =
        std::collections::HashMap::new();
    for e in &db.daily_log {
        by_date.insert(e.date, (e.done_daily, e.total_daily));
    }
    // 今天是进行中的一天，单独并入判定序列
    let today_counts: Option<(u32, u32)> = {
        let total = db.tasks.iter().filter(|t| t.kind == Kind::Daily).count() as u32;
        if total == 0 {
            None
        } else {
            Some((
                db.tasks
                    .iter()
                    .filter(|t| t.kind == Kind::Daily && t.done_date.is_some())
                    .count() as u32,
                total,
            ))
        }
    };

    let full = |c: (u32, u32)| c.1 > 0 && c.0 == c.1;

    // 当前连续：无每日任务 → None（不是 0）
    let current = today_counts.map(|c| {
        if full(c) {
            count_back(&by_date, today.pred_opt()) + 1
        } else {
            count_back(&by_date, today.pred_opt())
        }
    });

    // 最长纪录：把日志按日期排好，线性扫连续段；今天全勾则末位 +1
    let mut dates: Vec<NaiveDate> = by_date.keys().copied().collect();
    dates.sort_unstable();
    let mut longest = 0u32;
    let mut run = 0u32;
    let mut prev: Option<NaiveDate> = None;
    for date in dates {
        let c = by_date[&date];
        let contiguous = prev.map_or(true, |p| p.succ_opt() == Some(date));
        if full(c) {
            run = if contiguous && run > 0 { run + 1 } else { 1 };
            longest = longest.max(run);
        } else {
            run = 0;
        }
        prev = Some(date);
    }
    if let Some(c) = today_counts {
        if full(c) {
            let contiguous = prev.map_or(false, |p| p.succ_opt() == Some(today));
            run = if contiguous && run > 0 { run + 1 } else { 1 };
            longest = longest.max(run);
        }
    }

    let current = match (current, today_counts) {
        (None, _) => None,
        (c, _) => c,
    };
    (current, Some(longest).filter(|_| !by_date.is_empty()))
}

fn count_back(
    by_date: &std::collections::HashMap<NaiveDate, (u32, u32)>,
    start: Option<NaiveDate>,
) -> u32 {
    let full = |c: (u32, u32)| c.1 > 0 && c.0 == c.1;
    let mut n = 0u32;
    let mut day = start;
    while let Some(d) = day {
        match by_date.get(&d) {
            Some(c) if full(*c) => n += 1,
            _ => break,
        }
        day = d.pred_opt();
    }
    n
}

fn heatmap(db: &Database, today: NaiveDate, days: u32) -> Vec<HeatDay> {
    let mut by_date: std::collections::HashMap<NaiveDate, (u32, u32)> =
        std::collections::HashMap::new();
    for e in &db.daily_log {
        by_date.insert(e.date, (e.done_all, e.total_all));
    }
    // 今天尚未关账入日志，用实时状态叠加（否则今天的格子永远是 0/0）
    let today_live = (
        db.tasks.iter().filter(|t| t.done_date.is_some()).count() as u32,
        db.tasks.len() as u32,
    );
    let mut out = Vec::new();
    let mut day = today;
    for _ in 0..days {
        let (done, total) = if day == today {
            today_live
        } else {
            by_date.get(&day).copied().unwrap_or((0, 0))
        };
        out.push(HeatDay { date: day, done, total });
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

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    /// 只勾不取消（toggle 在已勾时会翻转，测试里要的是「当天勾上」）
    fn check_on(db: &mut Database, date: NaiveDate, id: &str) {
        let t = db.tasks.iter_mut().find(|t| t.id == id).unwrap();
        if t.done_date.is_none() {
            t.done_date = Some(date);
        }
    }

    // ── ① 今日概览 + 三类完成率（None 语义） ─────────
    #[test]
    fn summary_and_kind_rates() {
        let mut db = new_database();
        let daily = add_task(&mut db, d(2026, 9, 24), "每日A", Kind::Daily, None).unwrap();
        add_task(&mut db, d(2026, 9, 24), "每日B", Kind::Daily, None).unwrap();
        let lim =
            add_task(&mut db, d(2026, 9, 24), "限时", Kind::Limited, Some(d(2026, 9, 30))).unwrap();
        let _open = add_task(&mut db, d(2026, 9, 24), "不限时", Kind::Open, None).unwrap();
        toggle_done(&mut db, d(2026, 9, 24), &daily).unwrap();
        toggle_done(&mut db, d(2026, 9, 24), &lim).unwrap();

        let s = compute_stats(&db, d(2026, 9, 24));
        assert_eq!((s.today_done, s.today_total), (2, 4));
        assert_eq!(s.rate_daily, Some(0.5));
        assert_eq!(s.rate_limited, Some(1.0));
        assert_eq!(s.rate_open, Some(0.0));
        assert_eq!(s.streak_current, Some(0), "有每日任务但今天未全勾 → 0");

        let mut db2 = new_database();
        add_task(&mut db2, d(2026, 9, 24), "只有不限时", Kind::Open, None).unwrap();
        let s2 = compute_stats(&db2, d(2026, 9, 24));
        assert_eq!(s2.rate_daily, None);
        assert_eq!(s2.streak_current, None);
    }

    // ── ② streak：当前三形态 + 最长纪录 ─────────────
    #[test]
    fn streak_running_break_and_longest() {
        let mut db = new_database();
        let id = add_task(&mut db, d(2026, 9, 20), "刷题", Kind::Daily, None).unwrap();
        for day in [20, 21, 22] {
            toggle_done(&mut db, d(2026, 9, day), &id).unwrap();
            roll_over(&mut db, d(2026, 9, day + 1));
        }
        // 23 进行中
        let s = compute_stats(&db, d(2026, 9, 23));
        assert_eq!(s.streak_current, Some(3));
        assert_eq!(s.streak_longest, Some(3));

        // 23 断签，24 全勾重开
        roll_over(&mut db, d(2026, 9, 24));
        check_on(&mut db, d(2026, 9, 24), &id);
        let s2 = compute_stats(&db, d(2026, 9, 24));
        assert_eq!(s2.streak_current, Some(1), "昨日断 → 归零重计");
        assert_eq!(s2.streak_longest, Some(3), "最长纪录保留 3 天");

        // 再连 3 天（24-26 全勾，27 查看）→ 最长变 4
        // （进入新的一天先 roll_over 关账昨天的——与真实使用一致）
        roll_over(&mut db, d(2026, 9, 25));
        check_on(&mut db, d(2026, 9, 25), &id);
        roll_over(&mut db, d(2026, 9, 26));
        check_on(&mut db, d(2026, 9, 26), &id);
        roll_over(&mut db, d(2026, 9, 27));
        check_on(&mut db, d(2026, 9, 27), &id);
        let s3 = compute_stats(&db, d(2026, 9, 27));
        assert_eq!(s3.streak_current, Some(4));
        assert_eq!(s3.streak_longest, Some(4));
    }

    // ── ③ 按期完成率与积压告警 ──────────────────────
    #[test]
    fn on_time_rate_and_backlog() {
        let mut db = new_database();
        let a = add_task(&mut db, d(2026, 9, 24), "按期", Kind::Limited, Some(d(2026, 9, 26)))
            .unwrap();
        let _b = add_task(&mut db, d(2026, 9, 24), "过期", Kind::Limited, Some(d(2026, 9, 25)))
            .unwrap();
        add_task(&mut db, d(2026, 9, 20), "躺了4天", Kind::Open, None).unwrap();
        add_task(&mut db, d(2026, 9, 24), "新任务", Kind::Open, None).unwrap();
        toggle_done(&mut db, d(2026, 9, 24), &a).unwrap();
        // 跨两天：a 按期归档，b 过期归档
        roll_over(&mut db, d(2026, 9, 26));

        let s = compute_stats(&db, d(2026, 9, 26));
        assert_eq!(s.on_time_rate, Some(0.5));
        assert_eq!(s.backlog_count, 1, "躺 4 天的未完成不限时 = 积压；新任务不算");
        assert_eq!(s.oldest_backlog_days, Some(6), "9/20 → 9/26 = 6 天");
        assert_eq!(s.heatmap.len(), 30);
        assert_eq!(
            s.heatmap[29],
            HeatDay { date: d(2026, 9, 26), done: 0, total: 2 },
            "今天=实时口径：两个限时任务均已归档离场，在册=躺着的+新任务，未勾"
        );
    }

    // ── 纯函数无副作用 ──────────────────────────────
    #[test]
    fn compute_stats_is_pure() {
        let mut db = new_database();
        add_task(&mut db, d(2026, 9, 24), "t", Kind::Daily, None).unwrap();
        let before = format!("{:?}", db);
        let _ = compute_stats(&db, d(2026, 9, 24));
        assert_eq!(before, format!("{:?}", db));
    }

    // ── 热力图边界：日志断档按 0/0 呈现 ───────────────
    #[test]
    fn heatmap_handles_gaps() {
        let mut db = new_database();
        db.daily_log.push(DailyLogEntry {
            date: d(2026, 9, 1),
            done_daily: 1,
            total_daily: 1,
            done_all: 2,
            total_all: 3,
        });
        let s = compute_stats(&db, d(2026, 9, 30));
        assert_eq!(s.heatmap.len(), 30);
        assert_eq!(s.heatmap[0].date, d(2026, 9, 1));
        assert_eq!((s.heatmap[0].done, s.heatmap[0].total), (2, 3));
        assert_eq!((s.heatmap[1].done, s.heatmap[1].total), (0, 0), "断档天 = 0/0（未使用）");
    }
}
