import { invoke } from "@tauri-apps/api/core";
import type { StateDto } from "../main";
import { showView } from "./views";
import { showTip } from "./addbar";

/** 悬浮球视图：收球按钮 + 球面渲染（未完成数、全绿彩蛋）+ 点击展开 */
export function initBall(): void {
  document.getElementById("btn-ball")!.addEventListener("click", (e) => {
    e.stopPropagation();
    invoke("set_ball_mode", { on: true }).catch((err) => showTip(String(err)));
  });
  // 球面整体是拖动区（data-tauri-drag-region）；短按无位移 = 点击展开
  document.getElementById("ball")!.addEventListener("click", () => {
    invoke("set_ball_mode", { on: false }).catch((err) => showTip(String(err)));
  });
}

/** refresh 回流：根据 ball_mode 切视图、刷新球面数字与全绿态 */
export function renderBall(state: StateDto): void {
  if (state.ball_mode) {
    showView("ball");
    const undone = state.stats.today_total - state.stats.today_done;
    const ball = document.getElementById("ball")!;
    const count = document.getElementById("ball-count")!;
    count.textContent = undone > 99 ? "99+" : String(undone);
    const allDone = state.stats.today_total > 0 && undone === 0;
    ball.classList.toggle("ball-done", allDone);
  } else if (document.getElementById("view-ball")!.hidden === false) {
    showView("list"); // 从球展开：回清单视图（几何恢复由后端完成）
  }
}
