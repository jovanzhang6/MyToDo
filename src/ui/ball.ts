import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { StateDto } from "../main";
import { showView } from "./views";
import { showTip } from "./addbar";

const cur = getCurrentWindow();

/** 悬浮球视图：收球按钮 + 球面渲染（未完成数、全绿彩蛋）+ 拖动/点击展开 */
export function initBall(): void {
  document.getElementById("btn-ball")!.addEventListener("click", (e) => {
    e.stopPropagation();
    invoke("set_ball_mode", { on: true }).catch((err) => showTip(String(err)));
  });

  // 球的拖动/点击判定（预案启用：Tauri 拖动区会吞 click，改自研位移阈值）
  // 按住后位移 ≤4px 且松手 = 点击展开；位移超阈值 = 交给系统拖拽
  const ball = document.getElementById("ball")!;
  let sx = 0;
  let sy = 0;
  let dragging = false;
  ball.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    sx = e.clientX;
    sy = e.clientY;
    dragging = false;
    const onMove = (m: MouseEvent) => {
      if (dragging) return;
      if (Math.abs(m.clientX - sx) > 4 || Math.abs(m.clientY - sy) > 4) {
        dragging = true;
        cleanup();
        cur.startDragging();
      }
    };
    const onUp = () => {
      cleanup();
      if (!dragging) {
        invoke("set_ball_mode", { on: false }).catch((err) =>
          showTip(String(err))
        );
      }
    };
    const cleanup = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
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
