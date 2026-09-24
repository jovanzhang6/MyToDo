import { invoke } from "@tauri-apps/api/core";
import type { Window } from "@tauri-apps/api/window";
import { showTip } from "./addbar";

let btnPin: HTMLButtonElement;

/** 标题栏：拖动区属性、置顶按钮、隐藏到托盘按钮 */
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
}

export function setPin(on: boolean): void {
  btnPin.classList.toggle("active", on);
  btnPin.title = on ? "已置顶（点击取消）" : "未置顶（点击置顶）";
}
