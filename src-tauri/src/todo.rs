//! 任务引擎：纯函数 + 注入日期。本模块禁止获取系统时间——`today` 一律由命令层传入，
//! 保证跨天/过期/休眠补偿的全部行为可被单元测试钉住。

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Daily,
    Limited,
    Open,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub text: String,
    pub kind: Kind,
    /// 仅 Limited 使用；其他类型恒为 None
    pub due_date: Option<NaiveDate>,
    pub created_date: NaiveDate,
    /// Some(日期) = 本轮已完成（勾选日）；跨天后按类型重置或清除
    #[serde(default)]
    pub done_date: Option<NaiveDate>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    CompletedOn,
    ExpiredUnfinished,
    DeletedByUser,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArchiveEntry {
    pub task: Task,
    pub outcome: Outcome,
    /// 任务从列表消失的生效日
    pub removed_date: NaiveDate,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub always_on_top: bool,
    /// 玻璃层不透明度 0.10–0.95；None = 默认 0.5。P1 透明度滑杆随用户要求提前落地。
    #[serde(default)]
    pub opacity: Option<f32>,
}

/// 一天的任务快照（计数制）：roll_over 关闭该天前记录。
/// daily 两个数支撑打卡 streak；all 两个数支撑热力图/趋势（含限时、不限时的当日完成）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DailyLogEntry {
    pub date: NaiveDate,
    pub done_daily: u32,
    pub total_daily: u32,
    pub done_all: u32,
    pub total_all: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Database {
    pub schema_version: u32,
    /// 引擎推进到的最后一个自然日；None = 全新数据库
    pub last_active_date: Option<NaiveDate>,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub archive: Vec<ArchiveEntry>,
    #[serde(default)]
    pub window: Option<WindowState>,
    /// 每日任务逐日快照（切片 2 新增，旧数据文件 default 兼容）
    #[serde(default)]
    pub daily_log: Vec<DailyLogEntry>,
    /// 到期提醒：最近一次发送的自然日（同任务同天至多一次的依据）
    #[serde(default)]
    pub last_notified_date: Option<NaiveDate>,
    /// 到期提醒总开关（设置面板）
    #[serde(default = "default_true")]
    pub reminders_enabled: bool,
    /// 积压告警阈值（天）：不限时任务未动够 N 天触发告警（设置面板可调 1–30）
    #[serde(default = "default_backlog_days")]
    pub backlog_days: u32,
}

fn default_true() -> bool {
    true
}

fn default_backlog_days() -> u32 {
    3
}

pub fn new_database() -> Database {
    Database {
        schema_version: SCHEMA_VERSION,
        last_active_date: None,
        tasks: Vec::new(),
        archive: Vec::new(),
        window: None,
        daily_log: Vec::new(),
        last_notified_date: None,
        reminders_enabled: true,
        backlog_days: 3,
    }
}

/// 该天的全任务快照（roll_over 关闭一天前调用；此刻的任务状态即该日终态）。
fn snapshot_daily_log(db: &mut Database, date: NaiveDate) {
    let (done_daily, total_daily) = db.tasks.iter().fold((0u32, 0u32), |acc, t| match t.kind {
        Kind::Daily => (acc.0 + t.done_date.is_some() as u32, acc.1 + 1),
        _ => acc,
    });
    let done_all = db.tasks.iter().filter(|t| t.done_date.is_some()).count() as u32;
    let total_all = db.tasks.len() as u32;
    // 全空的一天不记（应用未使用的日子不污染热力图）
    if total_all > 0 {
        db.daily_log.push(DailyLogEntry {
            date,
            done_daily,
            total_daily,
            done_all,
            total_all,
        });
    }
}

/// 置顶状态：无窗口记录时默认置顶（产品决定：默认置顶 + 可切换）。
pub fn always_on_top(db: &Database) -> bool {
    db.window.map_or(true, |w| w.always_on_top)
}

#[derive(Debug, PartialEq)]
pub enum EngineError {
    EmptyText,
    DueDateRequired,
    TaskNotFound,
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let msg = match self {
            EngineError::EmptyText => "任务内容不能为空",
            EngineError::DueDateRequired => "限时任务需要选择到期日期",
            EngineError::TaskNotFound => "任务不存在",
        };
        f.write_str(msg)
    }
}

/// 把数据库推进到 `today`。幂等；一次跨多天与逐日重放完全等价（休眠补偿的基础）。
///
/// 每个新的一天 d（从 last_active+1 到 today）依次执行：
/// 1. 完成清除：`done_date < d` 的任务——Daily 重置为未完成；Open/Limited
///    归档 CompletedOn 并从列表移除（「完成即次日清除」）；
/// 2. 限时过期：Limited 且未完成且 `due_date < d` → 归档 ExpiredUnfinished 并移除。
///
/// 返回是否发生了推进（调用方可据此决定是否落盘）。
pub fn roll_over(db: &mut Database, today: NaiveDate) -> bool {
    let Some(last) = db.last_active_date else {
        db.last_active_date = Some(today);
        return true;
    };
    if today <= last {
        return false;
    }
    let mut d = last;
    while d < today {
        // 关闭 `last` 这一天：先留每日任务快照（此刻的任务状态即该日终态）
        snapshot_daily_log(db, d);
        d = d.succ_opt().expect("date overflow");
        // 1) 处理此前各日勾选的完成态
        let mut i = 0;
        while i < db.tasks.len() {
            let expired_done = matches!(db.tasks[i].done_date, Some(done) if done < d);
            if expired_done {
                match db.tasks[i].kind {
                    Kind::Daily => {
                        db.tasks[i].done_date = None;
                        i += 1;
                    }
                    Kind::Open | Kind::Limited => {
                        let task = db.tasks.remove(i);
                        db.archive.push(ArchiveEntry {
                            outcome: Outcome::CompletedOn,
                            removed_date: d,
                            task,
                        });
                    }
                }
            } else {
                i += 1;
            }
        }
        // 2) 未完成的限时任务到期
        let mut i = 0;
        while i < db.tasks.len() {
            let due_passed = db.tasks[i].kind == Kind::Limited
                && db.tasks[i].done_date.is_none()
                && matches!(db.tasks[i].due_date, Some(due) if due < d);
            if due_passed {
                let task = db.tasks.remove(i);
                db.archive.push(ArchiveEntry {
                    outcome: Outcome::ExpiredUnfinished,
                    removed_date: d,
                    task,
                });
            } else {
                i += 1;
            }
        }
    }
    db.last_active_date = Some(today);
    true
}

pub fn add_task(
    db: &mut Database,
    today: NaiveDate,
    text: &str,
    kind: Kind,
    due_date: Option<NaiveDate>,
) -> Result<String, EngineError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(EngineError::EmptyText);
    }
    if kind == Kind::Limited && due_date.is_none() {
        return Err(EngineError::DueDateRequired);
    }
    // 不变量：有任务必有日期锚点。否则下次 roll_over 会把「首次启动锚定」
    // 误当成推进，跳过这批任务的生命周期处理。
    if db.last_active_date.is_none() {
        db.last_active_date = Some(today);
    }
    let id = uuid::Uuid::new_v4().to_string();
    db.tasks.push(Task {
        id: id.clone(),
        text: text.to_string(),
        kind,
        due_date: if kind == Kind::Limited { due_date } else { None },
        created_date: today,
        done_date: None,
    });
    Ok(id)
}

/// 勾选/取消勾选。勾选记录当天日期；当天保持划线可见，次日由 roll_over 处置。
pub fn toggle_done(db: &mut Database, today: NaiveDate, id: &str) -> Result<(), EngineError> {
    let task = find_mut(db, id)?;
    task.done_date = if task.done_date.is_some() {
        None
    } else {
        Some(today)
    };
    Ok(())
}

/// 修改任务类型。改为 Limited 需要到期日（未传则沿用原值，原值也没有则报错）；
/// 改为 Daily/Open 清除到期日。完成态与既有归档不受影响。
pub fn set_kind(
    db: &mut Database,
    id: &str,
    kind: Kind,
    due_date: Option<NaiveDate>,
) -> Result<(), EngineError> {
    let task = find_mut(db, id)?;
    if kind == Kind::Limited {
        let due = due_date.or(task.due_date);
        if due.is_none() {
            return Err(EngineError::DueDateRequired);
        }
        task.due_date = due;
    } else {
        task.due_date = None;
    }
    task.kind = kind;
    Ok(())
}

pub fn edit_text(db: &mut Database, id: &str, text: &str) -> Result<(), EngineError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(EngineError::EmptyText);
    }
    find_mut(db, id)?.text = text.to_string();
    Ok(())
}

/// 删除 = 归档 DeletedByUser，绝不物理删除。
pub fn delete_task(db: &mut Database, today: NaiveDate, id: &str) -> Result<(), EngineError> {
    let pos = db
        .tasks
        .iter()
        .position(|t| t.id == id)
        .ok_or(EngineError::TaskNotFound)?;
    let task = db.tasks.remove(pos);
    db.archive.push(ArchiveEntry {
        outcome: Outcome::DeletedByUser,
        removed_date: today,
        task,
    });
    Ok(())
}

fn kind_rank(kind: Kind) -> u8 {
    match kind {
        Kind::Limited => 0,
        Kind::Open => 1,
        Kind::Daily => 2,
    }
}

/// 列表顺序合同（2026-09-25 业主修订）：
/// 未完成：限时（到期日升序）> 不限时 > 每日，同类内按创建先后；
/// 已完成（不分类型）恒排最后，内部按完成先后（done_date 升序）。
pub fn sorted_tasks(db: &Database) -> Vec<&Task> {
    let mut v: Vec<&Task> = db.tasks.iter().collect();
    let rank = |t: &Task| {
        if t.done_date.is_some() {
            3
        } else {
            kind_rank(t.kind)
        }
    };
    v.sort_by(|a, b| {
        rank(a)
            .cmp(&rank(b))
            .then_with(|| a.due_date.cmp(&b.due_date))
            .then_with(|| a.done_date.cmp(&b.done_date))
            .then_with(|| a.created_date.cmp(&b.created_date))
    });
    v
}

#[derive(Debug, Serialize)]
pub struct TaskView {
    pub id: String,
    pub text: String,
    pub kind: Kind,
    pub due_date: Option<NaiveDate>,
    pub due_today: bool,
    pub done: bool,
}

pub fn build_view(db: &Database, today: NaiveDate) -> Vec<TaskView> {
    sorted_tasks(db)
        .into_iter()
        .map(|t| TaskView {
            id: t.id.clone(),
            text: t.text.clone(),
            kind: t.kind,
            due_date: t.due_date,
            due_today: t.due_date == Some(today),
            done: t.done_date.is_some(),
        })
        .collect()
}

fn find_mut<'a>(db: &'a mut Database, id: &str) -> Result<&'a mut Task, EngineError> {
    db.tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or(EngineError::TaskNotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }
    fn base() -> NaiveDate {
        d(2026, 9, 24)
    }

    // ── B1 添加 ──────────────────────────────────
    #[test]
    fn b1_add_defaults_open_trim_and_rejections() {
        let mut db = new_database();
        let id = add_task(&mut db, base(), "  写周报  ", Kind::Open, None).unwrap();
        let t = &db.tasks[0];
        assert_eq!(t.id, id);
        assert_eq!(t.text, "写周报");
        assert_eq!(t.kind, Kind::Open);
        assert_eq!(t.due_date, None);
        assert_eq!(t.done_date, None);
        assert_eq!(t.created_date, base());

        assert_eq!(
            add_task(&mut db, base(), "x", Kind::Limited, None),
            Err(EngineError::DueDateRequired)
        );
        assert_eq!(
            add_task(&mut db, base(), "   ", Kind::Open, None),
            Err(EngineError::EmptyText)
        );
    }

    // ── B2 勾选 ──────────────────────────────────
    #[test]
    fn b2_toggle_marks_and_unmarks_today() {
        let mut db = new_database();
        let id = add_task(&mut db, base(), "t", Kind::Open, None).unwrap();
        toggle_done(&mut db, base(), &id).unwrap();
        assert_eq!(db.tasks[0].done_date, Some(base()));
        toggle_done(&mut db, base(), &id).unwrap();
        assert_eq!(db.tasks[0].done_date, None);
    }

    // ── B3 每日任务跨天 ───────────────────────────
    #[test]
    fn b3_daily_resets_next_day_and_stays() {
        let mut db = new_database();
        let id = add_task(&mut db, base(), "刷题", Kind::Daily, None).unwrap();
        toggle_done(&mut db, base(), &id).unwrap();
        roll_over(&mut db, base().succ_opt().unwrap());
        assert_eq!(db.tasks.len(), 1);
        assert_eq!(db.tasks[0].id, id);
        assert_eq!(db.tasks[0].done_date, None);
        assert!(db.archive.is_empty());
    }

    #[test]
    fn b3_daily_unchecked_persists_30_days() {
        let mut db = new_database();
        add_task(&mut db, base(), "刷题", Kind::Daily, None).unwrap();
        roll_over(&mut db, d(2026, 10, 24));
        assert_eq!(db.tasks.len(), 1);
        assert!(db.archive.is_empty());
    }

    // ── B4 限时任务 ──────────────────────────────
    #[test]
    fn b4_limited_visible_on_due_day_then_expired() {
        let mut db = new_database();
        let due = d(2026, 9, 26);
        let id = add_task(&mut db, base(), "交报告", Kind::Limited, Some(due)).unwrap();
        roll_over(&mut db, due);
        assert!(db.tasks.iter().any(|t| t.id == id), "到期日当天必须还在");
        let next = due.succ_opt().unwrap();
        roll_over(&mut db, next);
        assert!(db.tasks.is_empty());
        assert_eq!(db.archive.len(), 1);
        assert_eq!(db.archive[0].outcome, Outcome::ExpiredUnfinished);
        assert_eq!(db.archive[0].removed_date, next);
    }

    #[test]
    fn b4_limited_completed_early_archives_completed_next_day() {
        let mut db = new_database();
        let due = d(2026, 9, 30);
        let id = add_task(&mut db, base(), "提前做完", Kind::Limited, Some(due)).unwrap();
        toggle_done(&mut db, base(), &id).unwrap();
        roll_over(&mut db, base().succ_opt().unwrap());
        assert!(db.tasks.is_empty(), "完成即次日清除，不等到期日");
        assert_eq!(db.archive[0].outcome, Outcome::CompletedOn);
    }

    // ── B5 不限时任务 ────────────────────────────
    #[test]
    fn b5_open_done_archives_next_day_undone_persists() {
        let mut db = new_database();
        let a = add_task(&mut db, base(), "做完就消", Kind::Open, None).unwrap();
        let b = add_task(&mut db, base(), "一直放着", Kind::Open, None).unwrap();
        toggle_done(&mut db, base(), &a).unwrap();
        roll_over(&mut db, base().succ_opt().unwrap());
        assert_eq!(db.tasks.len(), 1);
        assert_eq!(db.tasks[0].id, b);
        assert_eq!(db.archive[0].outcome, Outcome::CompletedOn);
    }

    // ── B6 排序（2026-09-25 修订：已完成恒最后，按完成顺序） ──
    #[test]
    fn b6_order_limited_by_due_then_open_then_daily_stable() {
        let mut db = new_database();
        let daily = add_task(&mut db, base(), "每日", Kind::Daily, None).unwrap();
        let open1 = add_task(&mut db, base(), "不限时1", Kind::Open, None).unwrap();
        let open2 = add_task(&mut db, base(), "不限时2", Kind::Open, None).unwrap();
        let lim_far = add_task(&mut db, base(), "远期", Kind::Limited, Some(d(2026, 10, 1))).unwrap();
        let lim_today = add_task(&mut db, base(), "今天到期", Kind::Limited, Some(base())).unwrap();

        let view = build_view(&db, base());
        let ids: Vec<&str> = view.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                lim_today.as_str(),
                lim_far.as_str(),
                open1.as_str(),
                open2.as_str(),
                daily.as_str()
            ]
        );
    }

    #[test]
    fn b6_done_tasks_sink_to_bottom_ordered_by_completion() {
        let mut db = new_database();
        let d1 = add_task(&mut db, base(), "每日", Kind::Daily, None).unwrap();
        let o1 = add_task(&mut db, base(), "不限时", Kind::Open, None).unwrap();
        let l1 = add_task(&mut db, base(), "限时", Kind::Limited, Some(base())).unwrap();
        // 同日完成的先后无法区分（done_date 是天粒度），同日内按创建顺序兜底
        toggle_done(&mut db, base(), &o1).unwrap();
        toggle_done(&mut db, base(), &d1).unwrap();
        toggle_done(&mut db, base(), &l1).unwrap();

        let view = build_view(&db, base());
        let ids: Vec<&str> = view.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec![d1.as_str(), o1.as_str(), l1.as_str()]);

        // 跨天完成：先完成的排前面
        let mut db2 = new_database();
        let a = add_task(&mut db2, base(), "先完成", Kind::Open, None).unwrap();
        let b = add_task(&mut db2, base(), "后完成", Kind::Open, None).unwrap();
        toggle_done(&mut db2, base(), &b).unwrap();
        roll_over(&mut db2, base().succ_opt().unwrap());
        // b 在 24 日勾选、25 日被归档清除了——改为直接构造完成日期差异
        let mut db3 = new_database();
        let c1 = add_task(&mut db3, base(), "C", Kind::Open, None).unwrap();
        let c2 = add_task(&mut db3, base(), "D", Kind::Open, None).unwrap();
        toggle_done(&mut db3, base(), &c2).unwrap();
        let t = db3.tasks.iter_mut().find(|t| t.id == c1).unwrap();
        t.done_date = Some(base().pred_opt().unwrap()); // 前一天完成（补偿场景）
        let view = build_view(&db3, base());
        assert_eq!(view[0].id, c1, "更早完成的排更前");
    }

    #[test]
    fn b6_undone_come_before_done_across_kinds() {
        let mut db = new_database();
        let done_daily = add_task(&mut db, base(), "已完成每日", Kind::Daily, None).unwrap();
        toggle_done(&mut db, base(), &done_daily).unwrap();
        let undone_limited =
            add_task(&mut db, base(), "未完成限时", Kind::Limited, Some(d(2026, 10, 1))).unwrap();

        let view = build_view(&db, base());
        assert_eq!(view[0].id, undone_limited, "未完成限时优先于已完成每日");
        assert_eq!(view[1].id, done_daily);
    }

    // ── B7 类型修改 ──────────────────────────────
    #[test]
    fn b7_kind_conversions_follow_contract() {
        let mut db = new_database();
        let id = add_task(&mut db, base(), "任务", Kind::Open, None).unwrap();

        set_kind(&mut db, &id, Kind::Daily, None).unwrap();
        assert_eq!(db.tasks[0].kind, Kind::Daily);

        assert_eq!(
            set_kind(&mut db, &id, Kind::Limited, None),
            Err(EngineError::DueDateRequired),
            "每日转限时必须补到期日"
        );
        set_kind(&mut db, &id, Kind::Limited, Some(d(2026, 9, 30))).unwrap();
        assert_eq!(db.tasks[0].due_date, Some(d(2026, 9, 30)));

        set_kind(&mut db, &id, Kind::Open, None).unwrap();
        assert_eq!(db.tasks[0].due_date, None, "转非限时清除到期日");

        toggle_done(&mut db, base(), &id).unwrap();
        set_kind(&mut db, &id, Kind::Daily, None).unwrap();
        assert_eq!(db.tasks[0].done_date, Some(base()), "完成态跨转换保留");
        assert!(db.archive.is_empty(), "类型修改不产生归档");
    }

    // ── B8 删除归档 ──────────────────────────────
    #[test]
    fn b8_delete_archives_never_destroys() {
        let mut db = new_database();
        let id = add_task(&mut db, base(), "删我", Kind::Open, None).unwrap();
        delete_task(&mut db, base(), &id).unwrap();
        assert!(db.tasks.is_empty());
        assert_eq!(db.archive.len(), 1);
        assert_eq!(db.archive[0].outcome, Outcome::DeletedByUser);
        assert_eq!(
            delete_task(&mut db, base(), &id),
            Err(EngineError::TaskNotFound)
        );
    }

    // ── B9 幂等与休眠补偿 ────────────────────────
    #[test]
    fn b9_roll_over_idempotent_within_same_day() {
        let mut db = new_database();
        let id = add_task(&mut db, base(), "t", Kind::Daily, None).unwrap();
        toggle_done(&mut db, base(), &id).unwrap();
        assert!(!roll_over(&mut db, base()), "同日重复推进应为 no-op");
        assert_eq!(db.tasks[0].done_date, Some(base()), "同日不重置");
    }

    #[test]
    fn b9_sleep_span_equals_sequential_replay() {
        let build = |jump: bool| {
            let mut db = new_database();
            add_task(&mut db, base(), "限时未完成", Kind::Limited, Some(d(2026, 9, 26))).unwrap();
            let daily = add_task(&mut db, base(), "每日", Kind::Daily, None).unwrap();
            let open = add_task(&mut db, base(), "不限时", Kind::Open, None).unwrap();
            toggle_done(&mut db, base(), &daily).unwrap();
            toggle_done(&mut db, base(), &open).unwrap();
            let target = d(2026, 9, 28);
            if jump {
                roll_over(&mut db, target);
            } else {
                for day in [25, 26, 27, 28] {
                    roll_over(&mut db, d(2026, 9, day));
                }
            }
            db
        };
        let jumped = build(true);
        let sequential = build(false);

        // id 是随机 uuid，比较“形状”而非整库：类型 + 三个日期 + 归档结局
        let shape = |db: &Database| {
            (
                db.tasks
                    .iter()
                    .map(|t| (t.kind, t.due_date, t.done_date, t.created_date))
                    .collect::<Vec<_>>(),
                db.archive
                    .iter()
                    .map(|a| (a.outcome, a.removed_date))
                    .collect::<Vec<_>>(),
            )
        };
        assert_eq!(
            shape(&jumped),
            shape(&sequential),
            "一次跨 3 天必须与逐日重放完全等价"
        );
        assert_eq!(jumped.last_active_date, sequential.last_active_date);

        // 顺带钉住三种结局
        assert_eq!(jumped.tasks.len(), 1);
        assert_eq!(jumped.tasks[0].kind, Kind::Daily);
        assert_eq!(jumped.tasks[0].done_date, None);
        let outcomes: Vec<Outcome> = jumped.archive.iter().map(|a| a.outcome).collect();
        assert!(outcomes.contains(&Outcome::ExpiredUnfinished));
        assert!(outcomes.contains(&Outcome::CompletedOn));
    }
}
