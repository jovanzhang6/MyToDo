# AGENTS.md — MyToDo 项目工作约定

> 项目：MyToDo（Tauri 2 + Rust 桌面 TODO 小组件）。工作流档案见 `docs/vibe/`，决策记录见 `docs/vibe/mytodo/decisions.md`。

## 铁律：编辑失败 = 先重新读，绝不绕行

**遇到编辑失败（"File has been modified since read" 等任何写不进去的情况），唯一正确的动作是：重新 Read 该文件（相关区段），刷新认知后再 Edit。这是铁律，没有例外。**

- "文件已修改"的常见来源：vite 热重载、linter 格式化、之前的 shell 脚本（sed/python）改动、并行工具调用——无论哪种，都说明**你记忆里的文件内容已过期**。
- **禁止的绕行行为**（2026-09-25 悬浮球轮的实测教训）：绕开校验用 sed / python 脚本对同一文件继续盲改。当晚这造成了重复定义（同一函数/静态量出现 2–4 份）、编译连环报错、多轮无谓返工。
- 正确顺序：`Read 失败区段 → 用 Edit 精确修改 → cargo test / tsc 验证`。若文件已乱到难以局部 Edit，先完整 Read 全文，再用 Write 整体重写（以读到的最新内容为基准）。

## 其他既有约定

- 业务逻辑全部下沉 Rust 纯函数（日期注入），前端只做展示；测试 `cargo test`（src-tauri 下）+ `npx tsc --noEmit`。
- Rust 侧改动后必须**进程级重启** dev，不依赖热重载。**杀进程只准按路径杀 dev 产物，严禁按进程名 `taskkill //IM mytodo.exe`**——业主安装的正式版与 dev 同名，按名杀会连正式版一起带走（2026-10-10 实锤：业主反馈"进程经常莫名其妙消失"，根因就是历次 dev/打包前的按名强杀）。正确姿势：
  `powershell -NoProfile -Command "Get-Process mytodo -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*src-tauri*' } | Stop-Process -Force"`
  然后清 1420 端口残留 node → `pnpm tauri dev`。打包前同理只杀 dev 产物；需要停正式版必须先问业主。
- 进程消失排查：先看 `%APPDATA%\com.mytodo.app\mytodo.log`（panic 黑匣子 + 启动标记）与 Windows 事件日志 Application 的 1000/1001/1002。
- 发版：版本号三处同步（tauri.conf.json / Cargo.toml / package.json）→ tag `v*` → CI 自动构建发布。

<!-- shared-env:begin · 由 ZCode 定时任务自动维护，勿手改本节（项目自有约定写在本节外） · 最近同步 2026-10-10 -->
## 公共安装与环境速查（全机共享，定时任务并集同步）

**运行时与包管理**
- Python 只走 uv：`uv run`、`uv pip`，禁 `python -m pip`；无 pandoc。（唯一例外：`D:\work\.venv` 自带 pip 及 python-docx/python-pptx，用户要求保留）
- Node v24.18.0（`D:\software\nodejs`）；ffmpeg、git、uv 均在 PATH；pnpm 11 需 Node ≥ 22.13（`node:sqlite`）。
- Rust：rustup/cargo 1.98.1 stable-msvc（Git Bash 需 `export PATH="$HOME/.cargo/bin:$PATH"`）；cargo 已配 rsproxy.cn 国内镜像（`~/.cargo/config.toml`，本机 crates.io 仅 ~60KB/s，装国外依赖优先国内源）；MSVC 工具链 = VS Build Tools C++ 14.44。

**文档处理**
- LibreOffice 26.2.2：`D:\software\LibreOffice\program\soffice.exe`（已入 PATH）。`soffice --version` 会挂起；转换用 `soffice --headless --norestore --convert-to pdf`；文档验收链 = docx/pptx → PDF → `uv run --with pymupdf` 渲染 PNG。
- Word COM（PowerShell）：`New-Object -ComObject Word.Application`，另存 PDF 格式码 17；`antiword -m UTF-8`（Git Bash 自带）提取 .doc 文本；无 poppler/pdftoppm。

**视频与渲染**
- Remotion 共享浏览器已 setx：环境变量 `REMOTION_BROWSER_EXECUTABLE` → `D:\software\remotion-browser\chrome-headless-shell-win64\chrome-headless-shell.exe`，渲染免下载、免 `--browser-executable`；npm 拦截 esbuild postinstall 导致渲染报错时 `npm rebuild esbuild` 修复。
- 看视频：ZCode 的 Read 工具可直读 mp4（≤90s 全片 ~1fps 采样，音轨不进）；其他 agent 用 ffmpeg 抽帧（`select=not(mod(n,2))` + `tile=5x5` 网格逐张核对）。

**系统级安装规矩**
- 装软件尽量放 `D:\software`，少占 C 盘；非提权 shell 装 MSI 用 `msiexec /a TARGETDIR=... /qn` 管理员解包方式（普通 `/qn` 报 1603）；注意：部分工具沙箱会把 msiexec 写入虚拟化（退出码 0 实际没装）。
- winget 串行：本机同时只能跑一个 winget 安装，并行会静默挂起；Docker（仅本机）拉镜像一律走国内镜像源，Dockerfile 内 apt/pip/npm 同理（服务器不受此限）。

**应用与数据位置**
- OpenScreen（录屏）：程序 `C:\Users\31185\AppData\Local\Programs\Openscreen\`；数据真身 `D:\software\openscreen-data\`，`C:\Users\31185\AppData\Roaming\openscreen` 是指向它的 junction——清理磁盘别当孤儿目录删。
- Blender：`D:\software\blender-5.2.2-windows-x64`；自研录屏仓库 Clarity：`D:\study\clarity`。
<!-- shared-env:end -->
