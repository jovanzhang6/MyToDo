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
}
