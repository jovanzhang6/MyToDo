<div align="center">

# MyToDo

**一款常驻桌面的磨砂玻璃 TODO 小组件 · 每日任务自动刷新 · 限时任务到期提醒**

[![CI](https://github.com/jovanzhang6/MyToDo/actions/workflows/ci.yml/badge.svg)](https://github.com/jovanzhang6/MyToDo/actions/workflows/ci.yml)
[![Release](https://github.com/jovanzhang6/MyToDo/actions/workflows/release.yml/badge.svg)](https://github.com/jovanzhang6/MyToDo/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release Version](https://img.shields.io/github/v/release/jovanzhang6/MyToDo)](https://github.com/jovanzhang6/MyToDo/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2011-blue)](https://github.com/jovanzhang6/MyToDo/releases)

English | [简体中文](#功能)

</div>

---

MyToDo is a frosted-glass TODO widget that lives on your Windows 11 desktop. Daily tasks reset themselves at midnight, deadline tasks expire and archive themselves, and completion stats (streaks, 30-day heatmap, on-time rate) keep you honest. Built with **Tauri 2 + Rust**, the installer is ~1.3 MB.

## ✨ 功能

| | 功能 | 说明 |
|---|---|---|
| 🪟 | **磨砂玻璃小组件** | 常驻右上角，Acrylic 真材质，透明度滑杆实时可调，可收成悬浮球 |
| 🔁 | **三类任务** | 每日（跨天自动重置）/ 限时（到期自动归档）/ 不限时（常驻），类型随时互转 |
| ✅ | **完成即划线** | 勾选划线，次日自动清理；每日任务自动满血复活，无需重建 |
| 📊 | **统计整页** | 今日进度环、连续打卡与最长纪录、30 天热力图、分类完成率、按期完成率、积压告警 |
| 🔔 | **到期提醒** | 限时任务到期当天 Windows 原生通知（同任务同天至多一次，可在设置关闭） |
| 🖥 | **托盘常驻** | 关闭即入托盘、开机自启可配、单实例、左键托盘图标快速显隐 |

## 📥 下载安装

前往 [**Releases**](https://github.com/jovanzhang6/MyToDo/releases) 下载 `MyToDo_*_x64-setup.exe`，双击安装即可。

- 无需管理员权限；数据保存在 `%APPDATA%\com.mytodo.app\data.json`，卸载不丢失
- 需要 Windows 10 1809+ / Windows 11（自带 WebView2）

## 🛠 从源码构建

```bash
# 前置：Rust (stable-msvc) + Node.js 20+ + pnpm
pnpm install
pnpm tauri dev      # 开发调试
pnpm tauri build    # 产出安装包（src-tauri/target/release/bundle/nsis/）
```

## 🧪 测试

```bash
cd src-tauri
cargo test          # 28 个单元测试：任务生命周期、跨天等价性、统计口径、提醒去重、持久化
```

引擎层的所有时间均为注入（`today` 参数），跨天/休眠补偿等边界全部可测。

## 🏗 架构

```
src-tauri/src/
├── todo.rs      # 任务引擎：纯函数 + 注入日期（生命周期/排序/类型转换）
├── stats.rs     # 统计：streak、热力图、按期率、积压告警（只读）
├── notify.rs    # 到期提醒：去重判定纯函数 + toast 薄壳
├── store.rs     # JSON 原子持久化（临时文件 + rename）
├── commands.rs  # Tauri 命令层
└── window.rs    # 窗口几何/材质/悬浮球
src/ui/          # 无框架 TS：清单 / 统计 / 设置 / 悬浮球
```

设计原则：**业务逻辑全部下沉 Rust 纯函数**（时间注入、可单测），前端只做展示；数据为单 JSON 文件（原子写入，含 schema 版本）。

> 📁 `docs/vibe/` 收录了本项目从 PRD → 设计 → 单测 → QA → 迭代的完整工作流档案，是 [vibe-coding](https://github.com/) 方法论的实战记录，欢迎翻阅。

## 🗺 Roadmap

- [ ] macOS 适配（架构已预留，见 `docs/vibe/mytodo/decisions.md`）
- [ ] 悬浮球位置记忆
- [ ] 数据导出 / 备份

## 📄 License

[MIT](LICENSE) © 2026 jovanzhang6
