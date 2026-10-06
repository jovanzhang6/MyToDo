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

/** 添加条：类型三选（默认不限时）、限时截止日期+时刻（含 +1时/+1天 快捷）、回车添加 */
export function initAddbar(refresh: Refresh): void {
  const input = document.getElementById("new-task") as HTMLInputElement;
  const dueWrap = document.getElementById("due-wrap")!;
  const dueDate = document.getElementById("due-date") as HTMLInputElement;
  const dueTime = document.getElementById("due-time") as HTMLInputElement;
  dueDate.value = localToday();
  dueTime.value = "23:59";

  const kind = (): "daily" | "limited" | "open" =>
    document.querySelector<HTMLInputElement>('[name="kind"]:checked')!.value as
      | "daily"
      | "limited"
      | "open";

  // 截止时刻快捷键：+1时 平移整个时刻（可滚过午夜），+1天 只推日期
  const quickHour = document.createElement("button");
  quickHour.className = "quick";
  quickHour.textContent = "+1时";
  quickHour.addEventListener("click", () => shiftHour(1));
  dueWrap.appendChild(quickHour);

  const quick = document.createElement("button");
  quick.className = "quick";
  quick.textContent = "+1天";
  quick.addEventListener("click", () => shiftDue(1));
  dueWrap.appendChild(quick);

  // 截止日期组只在「限时」选中时展示（初始化即同步，防初始状态漏藏）
  const syncDueWrap = () => {
    dueWrap.hidden = kind() !== "limited";
    if (!dueWrap.hidden && !dueDate.value) dueDate.value = localToday();
    if (!dueWrap.hidden && !dueTime.value) dueTime.value = "23:59";
  };
  syncDueWrap();

  document.querySelectorAll<HTMLInputElement>('[name="kind"]').forEach((radio) => {
    radio.addEventListener("change", syncDueWrap);
  });

  const add = (): void => {
    const text = input.value.trim();
    if (!text) return;
    const k = kind();
    const due = k === "limited" ? dueDate.value || null : null;
    const dueT = k === "limited" ? dueTime.value || null : null;
    if (k === "limited" && !due) {
      showTip("限时任务需要选择到期日期");
      return;
    }
    invoke("add_task", { text, kind: k, dueDate: due, dueTime: dueT })
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

function shiftHour(hours: number): void {
  const d = document.getElementById("due-date") as HTMLInputElement;
  const t = document.getElementById("due-time") as HTMLInputElement;
  const base = new Date(`${d.value || localToday()}T${t.value || "23:59"}:00`);
  if (isNaN(base.getTime())) return;
  base.setMinutes(base.getMinutes() + hours * 60);
  const p = (n: number) => String(n).padStart(2, "0");
  d.value = `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`;
  t.value = `${p(base.getHours())}:${p(base.getMinutes())}`;
}

function shiftDue(days: number): void {
  const el = document.getElementById("due-date") as HTMLInputElement;
  const base = el.value ? new Date(el.value + "T00:00:00") : new Date();
  base.setDate(base.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  el.value = `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`;
}
