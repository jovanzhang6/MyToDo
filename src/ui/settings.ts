import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { showTip } from "./addbar";
import { setPin } from "./titlebar";

let draggingOpacity = false;

/** 把不透明度同步到根 CSS 变量（拖动滑杆预览期间不覆盖用户手势） */
export function applyGlassOpacity(opacity: number): void {
  if (draggingOpacity) return;
  document.documentElement.style.setProperty("--glass-alpha", opacity.toFixed(2));
}

/** 设置整页：外观滑杆实时预览松手落盘；三个开关即点即生效 */
export function initSettingsPage(): void {
  // 关于页版本号：运行时取自 tauri.conf.json，杜绝随版本发布漏改的写死值
  const aboutVersion = document.getElementById("about-version");
  if (aboutVersion) {
    getVersion()
      .then((v) => (aboutVersion.textContent = `v${v}`))
      .catch(() => {}); // 无 Tauri 环境（纯浏览器预览）保持占位值
  }

  const slider = document.getElementById("opacity-slider") as HTMLInputElement;
  const value = document.getElementById("opacity-value")!;

  slider.addEventListener("pointerdown", () => {
    draggingOpacity = true;
  });
  const endDrag = () => {
    draggingOpacity = false;
  };
  slider.addEventListener("pointerup", endDrag);
  slider.addEventListener("pointercancel", endDrag);

  slider.addEventListener("input", () => {
    const v = Number(slider.value) / 100;
    document.documentElement.style.setProperty("--glass-alpha", v.toFixed(2));
    value.textContent = `${slider.value}%`;
  });
  slider.addEventListener("change", () => {
    draggingOpacity = false;
    invoke<number>("set_opacity", { opacity: Number(slider.value) / 100 })
      .then((v) => {
        document.documentElement.style.setProperty("--glass-alpha", v.toFixed(2));
        value.textContent = `${Math.round(v * 100)}%`;
      })
      .catch((err) => showTip(String(err)));
  });

  wireToggle("reminders-toggle", "set_reminders_enabled", "on");
  wireToggle("autostart-toggle", "set_autostart", "on");

  // 积压阈值步进（1–30 天）；提醒关闭时整行灰显不可用
  const minus = document.getElementById("backlog-minus") as HTMLButtonElement;
  const plus = document.getElementById("backlog-plus") as HTMLButtonElement;
  minus.addEventListener("click", () => stepBacklog(-1));
  plus.addEventListener("click", () => stepBacklog(1));
  document.getElementById("pin-toggle")!.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const on = input.checked;
    setPin(on);
    invoke("set_always_on_top", { on }).catch((err) => {
      setPin(!on);
      showTip(String(err));
    });
  });

  // 求 Star：系统浏览器打开仓库主页
  document.getElementById("btn-star")!.addEventListener("click", () => {
    invoke("open_repo").catch((err) => showTip(String(err)));
  });
}

function wireToggle(id: string, cmd: string, argName: string): void {
  document.getElementById(id)!.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const on = input.checked;
    invoke(cmd, { [argName]: on }).catch((err) => {
      input.checked = !on;
      showTip(String(err));
    });
  });
}

/** refresh 回流：把后端当前值同步到设置页控件 */
export function renderSettings(state: {
  glass_opacity: number;
  reminders_enabled: boolean;
  backlog_days: number;
  autostart_enabled: boolean;
  always_on_top: boolean;
}): void {
  applyGlassOpacity(state.glass_opacity);
  const slider = document.getElementById("opacity-slider") as HTMLInputElement;
  const pct = String(Math.round(state.glass_opacity * 100));
  if (!draggingOpacity && slider.value !== pct) {
    slider.value = pct;
    document.getElementById("opacity-value")!.textContent = `${pct}%`;
  }
  (
    document.getElementById("reminders-toggle") as HTMLInputElement
  ).checked = state.reminders_enabled;
  (
    document.getElementById("autostart-toggle") as HTMLInputElement
  ).checked = state.autostart_enabled;
  setPin(state.always_on_top);
  syncBacklogRow(state.backlog_days, state.reminders_enabled);
}

function syncBacklogRow(days: number, remindersOn: boolean): void {
  document.getElementById("backlog-value")!.textContent = String(days);
  (
    document.getElementById("backlog-desc") as HTMLElement
  ).textContent = `不限时任务躺 ${days} 天未动时通知提醒，每天至多一条`;
  document.getElementById("backlog-row")!.classList.toggle("disabled", !remindersOn);
}

async function stepBacklog(delta: number): Promise<void> {
  const valueEl = document.getElementById("backlog-value")!;
  const prev = Number(valueEl.textContent);
  const next = Math.min(30, Math.max(1, prev + delta));
  if (next === prev) return;
  valueEl.textContent = String(next); // 即时反馈，失败立即回退并提示
  try {
    const v = await invoke<number>("set_backlog_days", { days: next });
    valueEl.textContent = String(v);
  } catch (err) {
    valueEl.textContent = String(prev);
    showTip(String(err));
  }
}
