# 设计：mytodo-stats-notify（统计 + 提醒 + 打包）
> 项目：mytodo · 切片 2/2
> 状态：已评审（2026-09-25 关卡 2 通过）
>
> 实施中修订（2026-09-25，业主反馈「统计太简陋、要独立页面、维度要有用」）：统计由悬浮小面板升级为**窗口内独立整页**（📊 切换 清单页↔统计页）。信息架构按 PM 三问重组：今日（大数字+进度环+剩余）、坚持（连续打卡+最长纪录+30 天热力图）、健康度（按期完成率+**积压告警**——躺 ≥3 天未动的不限时任务数与最老天数；砍掉不驱动行为的纯归档计数）。数据侧：DailyLogEntry 由每日任务快照扩为**全任务每日计数**（done/total × daily/all 四个数字），热力图与趋势才有意义；新增 longest streak / on-time rate / backlog 纯函数。冷启动（数据 <3 天）显示引导文案而非空零。

## 方案概述

统计与提醒都建立在同一个新数据基座上：**每日完成日志（daily_log）**。切片 1 只归档了 Open/Limited 的结局，每日任务的完成历史在重置时丢掉了——而 streak、完成率、30 天趋势全都要它。所以 `roll_over` 每关闭一天时，先记录该日快照（哪些任务存在、哪些已勾）再重置，之后统计就是纯函数查询。提醒复用切片 1 的跨天机制：跨天/唤醒补偿后检查到期任务，`last_notified_date` 保证同天只发一次；设置面板加「到期提醒」总开关（业主点名用好设置页）。最后 `tauri build` 产 NSIS 安装包并按 E 系验收。

## 改动影响面

```
src-tauri/src/todo.rs        # 改：Database 增 daily_log/last_notified_date/reminders_enabled；
                             #     roll_over 关闭一天前追加 DailyLogEntry（在现有等价性测试内自动被钉住）
src-tauri/src/stats.rs       # 新：compute_stats 纯函数（今日概览/三类完成率/streak/趋势30d/归档数）
src-tauri/src/notify.rs      # 新：due_check 纯函数（该不该提醒、提醒内容）+ toast 发送（薄壳）
src-tauri/src/commands.rs    # 改：StateDto 增 stats；新增 set_reminders_enabled；get_state 后挂提醒检查
src-tauri/src/lib.rs         # 改：注册新命令
src/ui/{titlebar,stats}.ts   # 改/新：标题栏统计图标入口；stats 面板（声明式 DOM，同 settings 模式）
src/ui/titlebar.ts           # 改：设置面板加「到期提醒」开关
index.html / styles.css      # 改：面板 DOM 与样式（复用 kind-pop/settings-pop 的视觉语言）
tauri.conf.json              # 改：bundle 标识完善（打包用）
```

- **schema 变化**（对蓝图「统计只读不改 schema」的实施中修订）：Database 新增三个带 `#[serde(default)]` 的字段，旧数据文件无痛升级；任务与归档的结构不变。此修订回写蓝图状态表备注。
- **波及既有切片**：roll_over 内部追加日志 = 触碰切片 1 引擎核心，回归范围为整个 TC-01 套件 + 数据文件往返；提醒逻辑挂在 get_state 尾部，可能改变「get_state 无副作用」的既有约定（新增一次可能的落盘）——在测试报告中明示。

## 数据与接口变化

- `Database` 新增：`daily_log: Vec<DailyLogEntry>`（`{date, done_ids, total_ids}`，只增）、`last_notified_date: Option<NaiveDate>`、`reminders_enabled: bool`（默认 true）。
- 新命令：`set_reminders_enabled(on)`；`StateDto` 增 `stats: StatsDto` 与 `reminders_enabled`。
- `StatsDto`：`{ today_done, today_total, rate_daily|rate_limited|rate_open: Option<f32>, streak: Option<u32>, trend: [(date, done, total); ≤30], archive_count }`（`None` = 无该类任务/无每日任务）。

## 风险与对策

1. **roll_over 改动破坏切片 1 行为** → 现有 15 个单测（含跨天等价性）先行兜底，改动后立即全量回归；等价性断言的 shape 函数纳入 daily_log 一致性。
2. **toast 在未打包形态仍是 PowerShell 署名** → E2 验收移到安装版执行，dev 阶段只验证「该发时发了」不纠结署名。
3. **daily_log 无限增长** → 只追加不清理，但每条 <100B，每天至多一条，10 年 <400KB，可接受；清理留待真需要时。
4. **streak 与趋势口径** → 全部基于 daily_log 逐日重放，禁止任何「当场重算历史」；口径单测钉死。

## 单元测试策略

框架同切片 1（`#[test]` + tempfile）。命令：`cargo test`。映射：

| 验收 | 测试 |
|---|---|
| C2/C3 | compute_stats：混合三类任务（勾/未勾/无该类）→ 概览数字与三类 Option 语义（None vs 0%）|
| C4 | streak 三形态：昨日全勾今日进行中（连续含今天）/ 昨日有未勾（归零）/ 无每日任务（None）；用 daily_log 构造历史 |
| C5 | compute_stats 为纯函数：调用前后 Database 位不变（Debug 断言）|
| C6 | 趋势：构造 35 天日志 → 取最近 30 天，done 计数与日志一致 |
| D1/D2 | due_check：今日有到期未提醒 → Some；同日重复 → None；`reminders_enabled=false` → None；次日新到期 → Some |
| 回归 | 切片 1 全套 15 测重跑全绿；daily_log 使 roll_over 等价性断言更新后仍成立 |

C1/C4 面板交互、D3 打扰性、E1–E4 安装行为：E 系由业主实测（安装包交付时给验证清单），面板交互 QA 手工过一遍。
