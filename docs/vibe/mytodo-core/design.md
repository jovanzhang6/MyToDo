# 设计：mytodo-core（磨砂窗口壳 + 三类任务引擎）
> 项目：mytodo · 切片 1/2
> 状态：草稿

## 方案概述

**Tauri 2 桌面壳 + Rust 纯函数任务引擎 + 无框架 TS 前端。** 选它的理由（蓝图已定）：跨端路径通（未来 mac）、包体 ~10MB、Acrylic/Mica 磨砂有官方方案。备选 Electron 因包体 100MB+ 且无 Rust 引擎生态被否；纯 Win32 无跨端被否。

核心架构决定一条：**任务生命周期全部是 Rust 纯函数，日期由外部注入（参数 `today`），引擎内禁止取系统时间。** 这样跨天重置、过期归档、休眠补偿全是同一份可单测代码——命令层取本地日期调用 `roll_over(db, today)`（幂等，重复调用无害），窗口显示、任何命令执行前都先过它，跨天补偿就"顺带"正确了，没有第二套逻辑。

窗口：无边框透明 + `window-vibrancy` 淡蓝 Acrylic（失败回退 Mica → CSS 半透明，三级兜底）；拖动用系统 `start_dragging`（标题区/空白区），缩放用 `start_resize_dragging` 的 8 边缘隐形热区；默认位置 = 主屏右上角留边距。

**一个 PRD 未覆盖的边界，此处理出**：限时任务**提前完成**（如 3 天期第 1 天勾掉）——统一规则「完成即次日清除」：`done_date` 非空的任务次日一律从列表消失归档（每日任务除外，它是重置）。未完成的限时任务才等到期日次日归档「过期未完成」。这与你需求 7 原文一致，QA 会单独测。

## 改动影响面（全新项目，全部新增）

```
D:\MyToDo
├── package.json / pnpm-lock.yaml      # 前端工程：vite + typescript（无框架）
├── vite.config.ts / index.html / tsconfig.json
├── src/                               # 前端（薄展示层，无业务逻辑）
│   ├── main.ts                        # 状态拉取、事件订阅、渲染调度
│   ├── ui/{titlebar,list,addbar}.ts    # 标题栏(拖动区+置顶+关闭)、清单、添加条
│   └── styles.css                     # 磨砂视觉、划线、红标「今天到期」
├── src-tauri/
│   ├── Cargo.toml / tauri.conf.json / capabilities/*.json   # 锁定 2.x 版本；transparent/decorations=false/min尺寸
│   └── src/
│       ├── main.rs · lib.rs           # 装配：插件(单实例/自启/通知预留)、托盘、窗口
│       ├── todo.rs                    # ★ 引擎：Task/Archive 模型、roll_over、排序、类型转换（纯函数）
│       ├── store.rs                   # ★ JSON 原子读写（临时文件+rename）、schema_version
│       ├── commands.rs                # #[tauri::command]：get_state/add/toggle/set_kind/edit/delete
│       ├── window.rs                  # 置顶切换、位置/尺寸记忆（事件防抖落盘）、右上角默认定位
│       └── tray.rs                    # 托盘菜单：显示隐藏/置顶√/自启√/退出
└── docs/vibe/…                        # 流水线产物（已有）
```

- **系统级影响**：需安装 rustup（stable-msvc）+ Visual Studio 2022 生成工具 C++ 工作负载，约 2–6GB——按约定与业主共同操作。
- **波及既有切片**：无（首个切片）。前端不设单测基建（薄展示层，逻辑全在 Rust，避免双实现）——此为测试基建决定，随本卡过目。

## 数据与接口变化

**数据文件** `%APPDATA%/com.mytodo.app/data.json`（schema_version: 1，原子写）：

```rust
Task      { id, text, kind: Daily|Limited|Open, due_date: Option<日期>,   // 仅 Limited
            created_date, done_date: Option<日期> }                        // Some=本轮已完成
Archive   { 快照(Task), outcome: CompletedOn|ExpiredUnfinished|DeletedByUser, removed_date }
Database  { schema_version, last_active_date, tasks: Vec<Task>, archive: Vec<Archive>,
            window: {x,y,w,h,always_on_top} }
```

> 实施中修订（2026-09-24，关卡 2 已过）：`settings.autostart` 从 JSON 中移除——自启状态直接以 tauri-plugin-autostart 的系统注册态为唯一事实源，托盘勾选态实时读它，避免双状态源漂移。
>
> 实施中修订（2026-09-25，两轮业主反馈驱动）：
> ① 磨砂材质最终定为 **Acrylic，透明度由 tint alpha 承载**——滑杆（P1 提前落地）实时重涂材质；Mica 曾作为聚焦一致性方案短暂采用，但其底盘不透明使滑杆失效，弃用。Acrylic 失焦略变实为系统行为，已向业主说明，如反馈强烈再做聚焦补偿。
> ② 引入 tauri-plugin-notification 提前到本切片，仅用于「关闭到托盘」的一次性反馈；开发模式借用 PowerShell 身份发 toast 属已知现象，打包安装后署名即为本应用。
> ③ 窗口 `shadow: true` 恢复（系统圆角与阴影），CSS 圆角对齐 8px，消除 CSS 圆角外灰直角。

归档只增不删（物理删除不存在）；切片 2 统计直接读 archive，不动 schema。

**Tauri 命令**（前端唯一入口）：`get_state()` 返回 `{today, tasks: 排序后视图, always_on_top}`；`add_task(text, kind, due?)`、`toggle_done(id)`、`set_kind(id, kind, due?)`（→Limited 缺日期时报错，前端引导补选）、`edit_text(id, text)`、`delete_task(id)`；`set_always_on_top(on)`。变更后后端 emit `state-changed`，前端重拉渲染。

**生命周期规则（引擎合同，单测对象）**：`roll_over(db, today)` 幂等且逐日重放——Open：done 次日归档 Completed；Limited：done 次日归档 Completed，未 done 则 due 次日归档 ExpiredUnfinished；Daily：done 次日重置为未完成（任务永驻）；排序 Limited(due 升序) < Open < Daily，同类内按创建先后。

## 风险与对策

1. **Acrylic 失焦/拖动卡顿**（Windows 已知怪癖）→ 三级回退链写死在装配代码；实测卡顿则降 Mica。最坏情况 CSS 半透明，功能无损。
2. **无边框缩放边缘难命中** → 8 热区各 6px + 最小尺寸 conf 级限制；QA 手工验收 A2。
3. **tauri 2.x 插件 API 漂移** → Cargo.toml 锁 minor 版本；安装与首次编译当场暴露，共同处理。
4. **时间泄漏导致单测不可靠** → 引擎模块 `#![deny]` 风格约定不引 chrono 的 now；代码评审自查。
5. **WebView2 缺失**（Win11 理论自带）→ 启动失败给出人话提示。

## 单元测试策略

框架：Rust 内建 `#[test]` + dev-dep `tempfile`（store 落盘测试）。跑法：`cargo test`（src-tauri 下）。验收标准 → 测试映射：

| 验收 | 测试 |
|---|---|
| B1 | add 默认 Open；add Limited 带/不带日期（报错）；add Daily |
| B2 | toggle 后 done_date=当日、视图标记完成 |
| B3 | Daily：昨日勾→今重置；昨日未勾→仍在未完成；连跨 5 天 |
| B4 | Limited：到期日当天在列；次日归档 ExpiredUnfinished；**提前完成次日归档 Completed** |
| B5 | Open：勾后次日归档 Completed 消失；不勾连跨 30 天仍在 |
| B6 | 三类混排精确顺序；Limited 按 due 升序；同类稳定 |
| B7 | 三类互转：到期日清除/必补、完成态保留、archive 不受影响 |
| B8 | delete → 归档 DeletedByUser，列表消失 |
| B9 | roll_over 同日幂等；一次跨 3 天 == 逐日跨 3 天（休眠补偿等价性） |
| B10 | store 往返一致（含中文/emoji）；schema_version 存在；写入为临时文件+rename |

A1–A6（视觉/交互/托盘）归 vibe-qa 手工与 E2E，不设前端单测。
