# 设计：mytodo-miniball（悬浮球模式）
> 项目：mytodo · M 级切片
> 状态：草稿

## 方案概述

**同一个窗口做形态切换，不开第二个窗口。** 收球 = 前端切到球视图（全屏圆球 DOM）+ 后端把窗口缩到 56×56 并临时关掉可缩放（防 conf 最小尺寸约束与用户误缩放）；展球 = 反向恢复。核心状态放 Rust（`ball_mode: bool` + `pre_ball: Option<WindowState>` 存在 Database.window 里但**不持久化球态本身**：落盘前把 ball_mode 剥离，强杀重启必为展开态——F6）。球的未完成数复用现有 state-changed 数据流，零新数据管道。备选「独立球窗口」被否：多窗口意味着双份状态同步、单实例/托盘/置顶全要处理两遍，复杂度不成比例。

## 改动影响面

```
src-tauri/src/todo.rs       # WindowState 增 ball_mode/pre_ball（含 serde default）；落盘剥离逻辑
src-tauri/src/commands.rs   # 新命令 set_ball_mode(on)；get_state 回传 ball_mode
src-tauri/src/window.rs     # apply_ball_geometry / restore_geometry（缩放开关、56px、恢复几何）
src/ui/ball.ts              # 球视图 DOM（未完成数徽章、P1 全绿态）、拖动区、点击展开
index.html / styles.css     # #view-ball + 圆球样式；标题栏收球按钮
src/ui/views.ts             # 四视图（list/stats/settings/ball），球视图不走 back 逻辑
```

- 波及既有切片：views.ts 视图模型从三视图变四视图（纯前端）；`sorted_tasks` 未动；提醒/统计/托盘零改动。托盘菜单新增「收成悬浮球/还原窗口」项（tray.rs 一行）。

## 数据与接口变化

- `WindowState` 增 `ball_mode: bool`（default false）、`pre_ball: Option<WindowState>`。
- 新命令 `set_ball_mode(on: bool)`：on=记忆当前几何→切球几何（关 resizable→56×56）；off=恢复 pre_ball 几何（开 resizable）。**落盘时**：若 ball_mode=true，写盘内容里 ball_mode 置 false 且 pre_ball 剥离（球态永不落盘，F6）。
- `StateDto` 增 `ball_mode: bool`；前端据此切视图。

## 风险与对策

1. **56px < conf minWidth 280** → 收球时 `set_resizable(false)` 后再 `set_size`（程序性 set_size 不受 resizable 限制），展球恢复 resizable(true)。
2. **拖动与点击冲突** → 球整体是 data-tauri-drag-region（按住即拖），click 事件只在无位移的短按时触发（Tauri 拖动区不拦截 click）；实测若冲突，改用 mousedown/mouseup 位移阈值判定（预案 20 行内）。
3. **球模式落盘污染窗口记忆** → store::save 前统一剥离（在 commands/store 单点处理，不散落）。
4. **透明度滑杆在球模式** → 滑杆仍可调（球跟随），无特殊处理。

## 单元测试策略

框架同前（cargo test）。球的交互（F1/F3/F4）为 GUI 行为，业主手测；单测钉数据合同：

| 验收 | 测试 |
|---|---|
| F2 数字口径 | ball 未完成数 = build_view 中 !done 计数（复用 stats.today_total-done，等价断言） |
| F6 球态不落盘 | 构造 ball_mode=true + pre_ball 的 Database → store::save/load 往返后 ball_mode=false、pre_ball=None、其余字段原样 |
| 回归 | 全套 27 测重跑全绿 |
