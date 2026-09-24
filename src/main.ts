import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { initTitlebar, setPin, setGlassOpacity } from "./ui/titlebar";
import { renderList } from "./ui/list";
import { initAddbar } from "./ui/addbar";

export interface TaskView {
  id: string;
  text: string;
  kind: "daily" | "limited" | "open";
  due_date: string | null;
  due_today: boolean;
  done: boolean;
}

export interface StateDto {
  today: string;
  tasks: TaskView[];
  always_on_top: boolean;
  glass_opacity: number;
}

export type Refresh = () => Promise<void>;

const cur = getCurrentWindow();
type RzDir = Parameters<typeof cur.startResizeDragging>[0];

let state: StateDto | null = null;

export async function refresh(): Promise<void> {
  try {
    state = await invoke<StateDto>("get_state");
    renderList(document.getElementById("list")!, state, refresh);
    setPin(state.always_on_top);
    setGlassOpacity(state.glass_opacity);
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
  await listen("state-changed", refresh);
  window.addEventListener("focus", refresh);
  await refresh();
}

init();
