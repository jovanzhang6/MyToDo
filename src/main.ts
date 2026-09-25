import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { initTitlebar, setPin } from "./ui/titlebar";
import { renderList } from "./ui/list";
import { initAddbar } from "./ui/addbar";
import { renderStats } from "./ui/stats";
import { initSettingsPage, renderSettings } from "./ui/settings";
import { initBall, renderBall } from "./ui/ball";

export interface TaskView {
  id: string;
  text: string;
  kind: "daily" | "limited" | "open";
  due_date: string | null;
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

export type Refresh = () => Promise<void>;

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

// 黑匣子：任何前端错误实时打进 Rust 日志（.tauri-dev.log），同时在窗口 tip 里可见。
// 带时间戳（区分新旧错误）且 6 秒自动清空（避免残影被当成新错误）。
let tipTimer: number | undefined;
function reportError(msg: string): void {
  const tip = document.getElementById("tip");
  if (tip) {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    tip.textContent = `${time} ${msg}`;
    clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => (tip.textContent = ""), 6000);
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

export async function refresh(): Promise<void> {
  try {
    state = await invoke<StateDto>("get_state");
    renderList(document.getElementById("list")!, state, refresh);
    setPin(state.always_on_top);
    renderStats(state);
    renderSettings(state);
    renderBall(state);
    renderTitleDate(state.today);
  } catch (e) {
    console.error("get_state 失败", e);
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

/** 本地时区 YYYY-MM-DD（不用 toISOString，它按 UTC 会提前切日） */
export function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function init(): Promise<void> {
  initResizeStrips();
  initMidnightWatcher();
  initTitlebar(cur);
  initAddbar(refresh);
  initSettingsPage();
  initBall();
  await listen("state-changed", refresh);
  window.addEventListener("focus", refresh);
  await refresh();
}

init();
