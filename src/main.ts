import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { initTitlebar, setPin } from "./ui/titlebar";
import { renderList, updateDueBadges } from "./ui/list";
import { initAddbar, showTip, syncAddbarDate } from "./ui/addbar";
import { renderStats } from "./ui/stats";
import { applyGlassOpacity, initSettingsPage, renderSettings } from "./ui/settings";
import { type BallSummaryDto, initBall, IS_BALL_WINDOW, renderBall } from "./ui/ball";
import { currentView, onViewChange } from "./ui/views";

export interface TaskView {
  id: string;
  text: string;
  kind: "daily" | "limited" | "open";
  due_date: string | null;
  /** "HH:MM:SS"（后端 ISO 格式，展示取前 5 位）；null = 旧天粒度任务 */
  due_time: string | null;
  due_today: boolean;
  done: boolean;
}

export interface StatsDto {
  today_done: number;
  today_total: number;
  streak_current: number | null;
  streak_longest: number | null;
  heatmap: { date: string; done: number; total: number }[];
  rate_daily: number | null;
  rate_limited: number | null;
  rate_open: number | null;
  on_time_rate: number | null;
  backlog_count: number;
  oldest_backlog_days: number | null;
}

export interface StateDto {
  today: string;
  tasks: TaskView[];
  always_on_top: boolean;
  ball_mode: boolean;
  glass_opacity: number;
  reminders_enabled: boolean;
  backlog_days: number;
  autostart_enabled: boolean;
  stats: StatsDto;
}

const cur = getCurrentWindow();
type RzDir = Parameters<typeof cur.startResizeDragging>[0];

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 标题栏日期："9月25日 周五"（今日语境，为每日任务与完成率提供时间锚点） */
function renderTitleDate(today: string): void {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const el = document.getElementById("app-title");
  if (el) el.textContent = `${m}月${d}日 ${weekday}`;
}

// 黑匣子：任何前端错误实时打进 Rust 日志，同时在窗口共享 tip 里可见（6 秒自动清空）。
function reportError(msg: string): void {
  if (!IS_BALL_WINDOW) {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    showTip(`${time} ${msg}`, 6000);
  }
  invoke("log_frontend", { msg }).catch(() => {});
}
window.addEventListener("error", (e) =>
  reportError(`JS错误: ${e.message} @${(e.filename || "").split("/").pop()}:${e.lineno}`)
);
window.addEventListener("unhandledrejection", (e) =>
  reportError(`Promise拒绝: ${String(e.reason)}`)
);

let state: StateDto | null = null;
let refreshInFlight = false;
let refreshQueued = false;

/** 单飞合并刷新：并发到达的状态事件合并到尾随一次，杜绝乱序回流覆盖 */
export async function refresh(): Promise<void> {
  if (refreshInFlight) {
    refreshQueued = true;
    return;
  }
  refreshInFlight = true;
  try {
    do {
      refreshQueued = false;
      const next = await invoke<StateDto>("get_state");
      state = next;
      applyState(next);
    } while (refreshQueued);
  } catch (e) {
    console.error("get_state 失败", e);
  } finally {
    refreshInFlight = false;
  }
}

function applyState(s: StateDto): void {
  renderList(document.getElementById("list")!, s);
  setPin(s.always_on_top);
  applyGlassOpacity(s.glass_opacity);
  syncAddbarDate(s.today);
  renderTitleDate(s.today);
  const view = currentView();
  if (view === "stats") renderStats(s);
  else if (view === "settings") renderSettings(s);
}

let ballInFlight = false;
let ballQueued = false;

async function refreshBall(): Promise<void> {
  if (ballInFlight) {
    ballQueued = true;
    return;
  }
  ballInFlight = true;
  try {
    do {
      ballQueued = false;
      const summary = await invoke<BallSummaryDto>("get_ball_summary");
      renderBall(summary);
    } while (ballQueued);
  } catch (e) {
    console.error("get_ball_summary 失败", e);
  } finally {
    ballInFlight = false;
  }
}

function initResizeStrips(): void {
  document.querySelectorAll<HTMLDivElement>(".rz").forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      cur.startResizeDragging(el.dataset.dir as RzDir);
    });
  });
}

function initMidnightWatcher(): void {
  let knownDay = localToday();
  setInterval(() => {
    const now = localToday();
    if (now !== knownDay) {
      knownDay = now;
      refresh();
    }
  }, 30_000);
}

/** 清单可见且存在未完成限时任务时，每 15 秒轻量更新徽标脉动，仅在越过到期线时才回拉后端归档 */
function initDueBadgeWatcher(): void {
  setInterval(() => {
    if (!state || currentView() !== "list") return;
    if (!state.tasks.some((t) => t.kind === "limited" && !t.done)) return;
    if (updateDueBadges(state.today)) {
      refresh();
    }
  }, 15_000);
}

/** 本地时区 YYYY-MM-DD（不用 toISOString，它按 UTC 会提前切日） */
export function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function init(): Promise<void> {
  if (IS_BALL_WINDOW) {
    initBall();
    await listen("state-changed", refreshBall);
    await refreshBall();
    return;
  }

  initResizeStrips();
  initMidnightWatcher();
  initDueBadgeWatcher();
  initTitlebar(cur);
  initAddbar();
  initSettingsPage();
  initBall();
  onViewChange((v) => {
    if (!state) return;
    if (v === "stats") renderStats(state);
    else if (v === "settings") renderSettings(state);
  });
  await listen("state-changed", refresh);
  window.addEventListener("focus", refresh);
  await refresh();
}

init();
