import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  initTitlebar,
  setPin,
  setGlassOpacity,
  setRemindersEnabled,
} from "./ui/titlebar";
import { renderList } from "./ui/list";
import { initAddbar } from "./ui/addbar";
import { initStatsPanel, renderStats } from "./ui/stats";

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
  rate_daily: number | null;
  rate_limited: number | null;
  rate_open: number | null;
  streak: number | null;
  trend: { date: string; done: number; total: number }[];
  archive_count: number;
}

export interface StateDto {
  today: string;
  tasks: TaskView[];
  always_on_top: boolean;
  glass_opacity: number;
  reminders_enabled: boolean;
  stats: StatsDto;
}

export type Refresh = () => Promise<void>;

const cur = getCurrentWindow();
type RzDir = Parameters<typeof cur.startResizeDragging>[0];

// 黑匣子：任何前端错误实时打进 Rust 日志（.tauri-dev.log），同时在窗口 tip 里可见
function reportError(msg: string): void {
  const tip = document.getElementById("tip");
  if (tip) tip.textContent = msg;
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
    setGlassOpacity(state.glass_opacity);
    setRemindersEnabled(state.reminders_enabled);
    renderStats(state);
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
  initStatsPanel();
  await listen("state-changed", refresh);
  window.addEventListener("focus", refresh);
  await refresh();
}

init();
