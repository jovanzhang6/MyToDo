# AGENTS.md — MyToDo 项目工作约定

> 项目：MyToDo（Tauri 2 + Rust 桌面 TODO 小组件）。工作流档案见 `docs/vibe/`，决策记录见 `docs/vibe/mytodo/decisions.md`。

## 铁律：编辑失败 = 先重新读，绝不绕行

**遇到编辑失败（"File has been modified since read" 等任何写不进去的情况），唯一正确的动作是：重新 Read 该文件（相关区段），刷新认知后再 Edit。这是铁律，没有例外。**

- "文件已修改"的常见来源：vite 热重载、linter 格式化、之前的 shell 脚本（sed/python）改动、并行工具调用——无论哪种，都说明**你记忆里的文件内容已过期**。
- **禁止的绕行行为**（2026-09-25 悬浮球轮的实测教训）：绕开校验用 sed / python 脚本对同一文件继续盲改。当晚这造成了重复定义（同一函数/静态量出现 2–4 份）、编译连环报错、多轮无谓返工。
- 正确顺序：`Read 失败区段 → 用 Edit 精确修改 → cargo test / tsc 验证`。若文件已乱到难以局部 Edit，先完整 Read 全文，再用 Write 整体重写（以读到的最新内容为基准）。

## 其他既有约定

- 业务逻辑全部下沉 Rust 纯函数（日期注入），前端只做展示；测试 `cargo test`（src-tauri 下）+ `npx tsc --noEmit`。
- Rust 侧改动后必须**进程级重启** dev（kill mytodo.exe + 清 1420 端口残留 node + `pnpm tauri dev`），不依赖热重载。
- 发版：版本号三处同步（tauri.conf.json / Cargo.toml / package.json）→ tag `v*` → CI 自动构建发布。
