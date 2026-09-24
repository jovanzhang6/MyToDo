import { invoke } from "@tauri-apps/api/core";
import type { Refresh } from "../main";
import { localToday } from "../main";

let tipTimer: number | undefined;

export function showTip(message: string): void {
  const tip = document.getElementById("tip")!;
  tip.textContent = message;
  clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => (tip.textContent = ""), 2600);
}

/** 添加条：类型三选（默认不限时）、限时日期（含今天/明天/后天快捷）、回车添加 */
export function initAddbar(refresh: Refresh): void {
  const input = document.getElementById("new-task") as HTMLInputElement;
  const dueWrap = document.getElementById("due-wrap")!;
  const dueDate = document.getElementById("due-date") as HTMLInputElement;
  dueDate.value = localToday();

  const kind = (): "daily" | "limited" | "open" =>
    document.querySelector<HTMLInputElement>('[name="kind"]:checked')!.value as
      | "daily"
      | "limited"
      | "open";

  // 限时日期快捷键
  const quick = document.createElement("button");
  quick.className = "quick";
  quick.textContent = "+1天";
  quick.addEventListener("click", () => shiftDue(1));
  dueWrap.appendChild(quick);

  document.querySelectorAll<HTMLInputElement>('[name="kind"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      dueWrap.hidden = kind() !== "limited";
      if (!dueWrap.hidden && !dueDate.value) dueDate.value = localToday();
    });
  });

  const add = (): void => {
    const text = input.value.trim();
    if (!text) return;
    const k = kind();
    const due = k === "limited" ? dueDate.value || null : null;
    if (k === "limited" && !due) {
      showTip("限时任务需要选择到期日期");
      return;
    }
    invoke("add_task", { text, kind: k, dueDate: due })
      .then(() => {
        input.value = "";
        refresh();
      })
      .catch((e) => showTip(String(e)));
  };

  document.getElementById("btn-add")!.addEventListener("click", add);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") add();
  });
}

function shiftDue(days: number): void {
  const el = document.getElementById("due-date") as HTMLInputElement;
  const base = el.value ? new Date(el.value + "T00:00:00") : new Date();
  base.setDate(base.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  el.value = `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`;
}
