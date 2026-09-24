import { invoke } from "@tauri-apps/api/core";
import type { Window } from "@tauri-apps/api/window";
import { showTip } from "./addbar";
import { showView, currentView } from "./views";

let btnPin: HTMLButtonElement;

/** 标题栏：拖动区、📊/⚙ 页面切换、置顶、隐藏到托盘 */
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

  // 📊 / ⚙ = 页面切换；再点当前页的图表按钮则回清单
  document.getElementById("btn-stats")!.addEventListener("click", (e) => {
    e.stopPropagation();
    showView(currentView() === "stats" ? "list" : "stats");
  });
  document.getElementById("btn-settings")!.addEventListener("click", (e) => {
    e.stopPropagation();
    showView(currentView() === "settings" ? "list" : "settings");
  });
  document.getElementById("btn-stats-back")!.addEventListener("click", () => showView("list"));
  document.getElementById("btn-settings-back")!.addEventListener("click", () => showView("list"));
}

export function setPin(on: boolean): void {
  btnPin.classList.toggle("active", on);
  btnPin.title = on ? "已置顶（点击取消）" : "未置顶（点击置顶）";
  const t = document.getElementById("pin-toggle") as HTMLInputElement | null;
  if (t) t.checked = on;
}
