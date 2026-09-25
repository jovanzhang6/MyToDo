import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { StateDto } from "../main";
import { showTip } from "./addbar";

const cur = getCurrentWindow();
/** 本窗口是否为悬浮球窗（主窗 label=main，球窗 label=ball） */
export const IS_BALL_WINDOW = cur.label === "ball";

/** 悬浮球：主窗的收球按钮 + 球窗的拖动/点击展开 + 双窗共用的球面渲染 */
export function initBall(): void {
  if (IS_BALL_WINDOW) {
    document.body.classList.add("ball-window");
    // 球窗里球视图常驻（HTML 自带 hidden 属性，必须显式摘掉）
    document.getElementById("view-ball")!.hidden = false;
    // 球窗：按住位移 ≤4px = 点击展开；超阈值 = 交给系统拖拽
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
    return;
  }

  // 主窗：标题栏收球按钮
  document.getElementById("btn-ball")!.addEventListener("click", (e) => {
    e.stopPropagation();
    invoke("set_ball_mode", { on: true }).catch((err) => showTip(String(err)));
  });
}

/** refresh 回流：球窗渲染球面；主窗无需处理（收球时主窗整体隐藏） */
export function renderBall(state: StateDto): void {
  if (!IS_BALL_WINDOW) return;
  const { today_done, today_total } = state.stats;
  const undone = today_total - today_done;
  const pct = today_total === 0 ? 0 : Math.round((today_done / today_total) * 100);
  const ball = document.getElementById("ball")!;
  ball.style.setProperty("--p", `${pct}%`);
  document.getElementById("ball-count")!.textContent =
    undone > 99 ? "99+" : String(undone);
  const allDone = today_total > 0 && undone === 0;
  ball.classList.toggle("ball-done", allDone);
}
