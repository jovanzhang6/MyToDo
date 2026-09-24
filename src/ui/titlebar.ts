import { invoke } from "@tauri-apps/api/core";
import type { Window } from "@tauri-apps/api/window";
import { showTip } from "./addbar";

let btnPin: HTMLButtonElement;
let slider: HTMLInputElement | null = null;
let valueLabel: HTMLSpanElement | null = null;
let currentOpacity = 0.5;

/** 标题栏：拖动区属性、设置气泡、置顶按钮、隐藏到托盘按钮 */
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

  document.getElementById("btn-settings")!.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSettingsPop(e);
  });
}

export function setPin(on: boolean): void {
  btnPin.classList.toggle("active", on);
  btnPin.title = on ? "已置顶（点击取消）" : "未置顶（点击置顶）";
}

/** 后端回流 + 滑杆拖动共用：立即生效到视觉层 */
export function setGlassOpacity(v: number): void {
  currentOpacity = v;
  document.documentElement.style.setProperty("--glass-alpha", v.toFixed(2));
  if (slider && valueLabel) {
    slider.value = String(Math.round(v * 100));
    valueLabel.textContent = `${Math.round(v * 100)}%`;
  }
}

function toggleSettingsPop(e: MouseEvent): void {
  if (document.getElementById("settings-pop")) {
    closeSettingsPop();
    return;
  }
  const pop = document.createElement("div");
  pop.id = "settings-pop";
  pop.className = "settings-pop";

  const label = document.createElement("label");
  label.append(document.createTextNode("不透明度"));
  slider = document.createElement("input");
  slider.type = "range";
  slider.min = "10";
  slider.max = "95";
  slider.step = "5";
  valueLabel = document.createElement("span");
  valueLabel.className = "opacity-value";
  label.append(slider, valueLabel);
  pop.appendChild(label);
  document.body.appendChild(pop);
  setGlassOpacity(currentOpacity);

  // 拖动即时预览，松手才落盘
  slider.addEventListener("input", () => {
    setGlassOpacity(Number(slider!.value) / 100);
  });
  slider.addEventListener("change", () => {
    invoke<number>("set_opacity", { opacity: Number(slider!.value) / 100 })
      .then((v) => setGlassOpacity(v))
      .catch((err) => showTip(String(err)));
  });

  const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
  pop.style.left = Math.min(anchor.left, window.innerWidth - 210) + "px";
  pop.style.top = anchor.bottom + 6 + "px";
  setTimeout(() => document.addEventListener("mousedown", onOutside), 0);
}

function onOutside(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (!target.closest(".settings-pop") && !target.closest("#btn-settings")) {
    closeSettingsPop();
  }
}

function closeSettingsPop(): void {
  document.getElementById("settings-pop")?.remove();
  slider = null;
  valueLabel = null;
  document.removeEventListener("mousedown", onOutside);
}
