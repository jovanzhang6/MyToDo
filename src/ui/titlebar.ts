import { invoke } from "@tauri-apps/api/core";
import type { Window } from "@tauri-apps/api/window";
import { showTip } from "./addbar";

let btnPin: HTMLButtonElement;
let pop: HTMLElement;
let slider: HTMLInputElement;
let valueLabel: HTMLSpanElement;
let currentOpacity = 0.5;
let remindersEnabled = true;

/** 标题栏：拖动区属性、设置面板（声明式 DOM，hidden 切换）、置顶、隐藏到托盘 */
export function initTitlebar(win: Window): void {
  // 拖动由 Tauri 注入脚本处理：带 data-tauri-drag-region 的元素按下即拖动
  document.getElementById("titlebar")!.setAttribute("data-tauri-drag-region", "");
  document.getElementById("app-title")!.setAttribute("data-tauri-drag-region", "");

  btnPin = document.getElementById("btn-pin") as HTMLButtonElement;
  btnPin.addEventListener("click", () => {
    const next = !btnPin.classList.contains("active");
    invoke("set_always_on_top", { on: next }).catch((e) => showTip(String(e)));
    // 状态以 refresh 回流为准；这里先即时反馈
    setPin(next);
  });

  document.getElementById("btn-close")!.addEventListener("click", () => {
    invoke("hide_window").catch(() => win.hide());
  });

  pop = document.getElementById("settings-pop")!;
  slider = document.getElementById("opacity-slider") as HTMLInputElement;
  valueLabel = document.getElementById("opacity-value") as HTMLSpanElement;

  const remindersToggle = document.getElementById(
    "reminders-toggle"
  ) as HTMLInputElement;
  // 打开设置面板时，把开关同步到后端当前值（回流写在 refresh 里）
  document.getElementById("btn-settings")!.addEventListener("click", () => {
    remindersToggle.checked = remindersEnabled;
  });
  remindersToggle.addEventListener("change", () => {
    invoke("set_reminders_enabled", { on: remindersToggle.checked }).catch(
      (err) => showTip(String(err))
    );
  });

  document.getElementById("btn-settings")!.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    if (!pop.hidden) {
      slider.value = String(Math.round(currentOpacity * 100));
      valueLabel.textContent = `${slider.value}%`;
      const btn = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const pw = pop.offsetWidth || 206; // 显示后量实际宽度，避免硬编码漂移
      pop.style.left =
        Math.max(8, Math.min(btn.left - 20, window.innerWidth - pw - 8)) + "px";
      pop.style.top = btn.bottom + 6 + "px";
    }
  });

  // 拖动即时预览，松手才落盘
  slider.addEventListener("input", () => applyOpacity(Number(slider.value) / 100));
  slider.addEventListener("change", () => {
    invoke<number>("set_opacity", { opacity: Number(slider.value) / 100 })
      .then((v) => setGlassOpacity(v))
      .catch((err) => showTip(String(err)));
  });

  document.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    if (!pop.hidden && !t.closest("#settings-pop") && !t.closest("#btn-settings")) {
      pop.hidden = true;
    }
  });
}

export function setPin(on: boolean): void {
  btnPin.classList.toggle("active", on);
  btnPin.title = on ? "已置顶（点击取消）" : "未置顶（点击置顶）";
}

/** 后端回流：提醒开关当前值（供设置面板打开时显示） */
export function setRemindersEnabled(on: boolean): void {
  remindersEnabled = on;
}

/** 后端回流 + 滑杆松手回流共用：刷新缓存的当前值并立即生效到视觉层 */
export function setGlassOpacity(v: number): void {
  currentOpacity = v;
  applyOpacity(v);
}

function applyOpacity(v: number): void {
  currentOpacity = v;
  document.documentElement.style.setProperty("--glass-alpha", v.toFixed(2));
  if (slider && valueLabel) {
    slider.value = String(Math.round(v * 100));
    valueLabel.textContent = `${Math.round(v * 100)}%`;
  }
}
