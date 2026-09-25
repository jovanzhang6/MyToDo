import { invoke } from "@tauri-apps/api/core";
import { showTip } from "./addbar";

/** 设置整页：外观滑杆实时预览松手落盘；三个开关即点即生效 */
export function initSettingsPage(): void {
  const slider = document.getElementById("opacity-slider") as HTMLInputElement;
  const value = document.getElementById("opacity-value")!;

  slider.addEventListener("input", () => {
    const v = Number(slider.value) / 100;
    document.documentElement.style.setProperty("--glass-alpha", v.toFixed(2));
    value.textContent = `${slider.value}%`;
  });
  slider.addEventListener("change", () => {
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
    const on = (e.target as HTMLInputElement).checked;
    invoke("set_always_on_top", { on }).catch((err) => showTip(String(err)));
  });
}

function wireToggle(id: string, cmd: string, argName: string): void {
  document.getElementById(id)!.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    invoke(cmd, { [argName]: on }).catch((err) => showTip(String(err)));
  });
}

/** refresh 回流：把后端当前值同步到设置页控件 */
export function renderSettings(state: {
  glass_opacity: number;
  reminders_enabled: boolean;
  backlog_days: number;
  autostart_enabled: boolean;
}): void {
  const slider = document.getElementById("opacity-slider") as HTMLInputElement;
  // 拖动中不被回流打断（回流值与滑杆一致时跳过）
  if (Number(slider.value) !== Math.round(state.glass_opacity * 100)) {
    slider.value = String(Math.round(state.glass_opacity * 100));
    document.getElementById("opacity-value")!.textContent = `${slider.value}%`;
  }
  (
    document.getElementById("reminders-toggle") as HTMLInputElement
  ).checked = state.reminders_enabled;
  (
    document.getElementById("autostart-toggle") as HTMLInputElement
  ).checked = state.autostart_enabled;
  syncBacklogRow(state.backlog_days, state.reminders_enabled);
}

function syncBacklogRow(days: number, remindersOn: boolean): void {
  document.getElementById("backlog-value")!.textContent = String(days);
  (
    document.getElementById("backlog-desc") as HTMLElement
  ).textContent = `不限时任务躺 ${days} 天未动时在统计页告警`;
  document.getElementById("backlog-row")!.classList.toggle("disabled", !remindersOn);
}

async function stepBacklog(delta: number): Promise<void> {
  const valueEl = document.getElementById("backlog-value")!;
  const next = Math.min(30, Math.max(1, Number(valueEl.textContent) + delta));
  if (String(next) === valueEl.textContent) return;
  valueEl.textContent = String(next); // 即时反馈，失败由回流纠正
  try {
    const v = await invoke<number>("set_backlog_days", { days: next });
    valueEl.textContent = String(v);
  } catch (err) {
    showTip(String(err));
  }
}
