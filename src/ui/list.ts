import { invoke } from "@tauri-apps/api/core";
import type { Refresh, StateDto, TaskView } from "../main";
import { showTip } from "./addbar";

const KIND_LABEL: Record<TaskView["kind"], string> = {
  daily: "每日",
  limited: "限时",
  open: "不限时",
};

/** 限时任务的到期徽标文案与样式（时刻粒度：今天/明天带时刻；<15 分钟加急脉动） */
function dueBadge(
  task: TaskView,
  today: string
): { text: string; dueToday: boolean; soon: boolean } | null {
  if (task.kind !== "limited" || !task.due_date) return null;
  const hm = task.due_time ? task.due_time.slice(0, 5) : null;
  const mins = minutesUntil(task.due_date, task.due_time);
  const diff = daysBetween(today, task.due_date);
  if ((mins !== null && mins <= 0) || diff < 0) {
    return { text: "已到期", dueToday: true, soon: true };
  }
  if (diff >= 2) {
    return { text: diff === 2 ? "后天到期" : `${diff}天后到期`, dueToday: false, soon: false };
  }
  if (diff === 1) {
    return {
      text: hm ? `明天 ${hm}` : "明天到期",
      dueToday: false,
      soon: (mins ?? Infinity) < 15,
    };
  }
  return {
    text: hm ? `今天 ${hm}` : "今天到期",
    dueToday: true,
    soon: (mins ?? Infinity) < 15,
  };
}

/** 距到期分钟的分钟数（本地时钟，仅展示；过期归档由后端裁决）。天粒度任务返回 null */
function minutesUntil(dueDate: string, dueTime: string | null): number | null {
  if (!dueTime) return null;
  const t = new Date(`${dueDate}T${dueTime.slice(0, 5)}:00`);
  if (isNaN(t.getTime())) return null;
  return Math.round((t.getTime() - Date.now()) / 60_000);
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function renderList(root: HTMLElement, state: StateDto, refresh: Refresh): void {
  root.textContent = "";
  if (state.tasks.length === 0) {
    const tip = document.createElement("div");
    tip.id = "empty-tip";
    tip.textContent = "还没有任务\n在下方输入，回车添加";
    root.appendChild(tip);
    return;
  }

  for (const task of state.tasks) {
    root.appendChild(buildRow(task, state.today, refresh));
  }
}

function buildRow(task: TaskView, today: string, refresh: Refresh): HTMLElement {
  const row = document.createElement("div");
  row.className = "task-row" + (task.done ? " done" : "");
  row.dataset.id = task.id;

  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = task.done;
  check.title = "完成 / 取消完成";
  check.addEventListener("change", () =>
    invoke("toggle_done", { id: task.id })
      .then(refresh)
      .catch((e) => showTip(String(e)))
  );

  const text = document.createElement("span");
  text.className = "task-text";
  text.textContent = task.text;
  text.title = "双击编辑";
  text.addEventListener("dblclick", () => beginEdit(row, text, task, refresh));

  const badge = document.createElement("span");
  badge.className = "badge " + task.kind;
  badge.textContent = KIND_LABEL[task.kind];
  if (task.kind === "limited") {
    const due = dueBadge(task, today);
    if (due) {
      badge.textContent = `${KIND_LABEL.limited} · ${due.text}`;
      badge.classList.toggle("due-today", due.dueToday);
      badge.classList.toggle("due-now", due.soon);
    }
  }
  // 点击徽标 = 修改类型 / 到期日（B7）
  badge.addEventListener("click", (e) => openKindPop(e, task, refresh));

  const del = document.createElement("button");
  del.className = "task-del";
  del.textContent = "×";
  del.title = "删除";
  del.addEventListener("click", () =>
    invoke("delete_task", { id: task.id })
      .then(refresh)
      .catch((e) => showTip(String(e)))
  );

  row.append(check, text, badge, del);
  return row;
}

/** 行内编辑：双击文字 → 输入框，Enter/失焦提交，Esc 取消 */
function beginEdit(
  row: HTMLElement,
  textEl: HTMLElement,
  task: TaskView,
  refresh: Refresh
): void {
  const input = document.createElement("input");
  input.className = "edit-input";
  input.maxLength = 200;
  input.value = task.text;
  textEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save: boolean) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (save && value && value !== task.text) {
      invoke("edit_text", { id: task.id, text: value })
        .then(refresh)
        .catch((e) => showTip(String(e)));
    } else {
      refresh();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  row.querySelector(".badge")?.setAttribute("hidden", "true");
}

/** 类型修改气泡：三类互转；转限时需日期与时刻（沿用原值可改期） */
function openKindPop(e: MouseEvent, task: TaskView, refresh: Refresh): void {
  e.stopPropagation();
  closeKindPop();

  const pop = document.createElement("div");
  pop.id = "kind-pop";
  pop.className = "kind-pop";

  const mk = (value: TaskView["kind"], label: string) => {
    const labelEl = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "pop-kind";
    radio.value = value;
    radio.checked = task.kind === value;
    labelEl.append(radio, document.createTextNode(label));
    return labelEl;
  };
  pop.append(mk("open", "不限时"), mk("daily", "每日"), mk("limited", "限时（需日期）"));

  const due = document.createElement("input");
  due.type = "date";
  due.value = task.due_date ?? "";
  pop.appendChild(due);

  const dueT = document.createElement("input");
  dueT.type = "time";
  dueT.value = task.due_time ? task.due_time.slice(0, 5) : "";
  pop.appendChild(dueT);

  const ok = document.createElement("button");
  ok.className = "pop-ok";
  ok.textContent = "确认";
  ok.addEventListener("click", () => {
    const kind = (pop.querySelector<HTMLInputElement>('[name="pop-kind"]:checked')?.value ??
      task.kind) as TaskView["kind"];
    const dueDate = kind === "limited" ? due.value || null : null;
    const dueTime = kind === "limited" ? dueT.value || null : null;
    invoke("set_kind", { id: task.id, kind, dueDate, dueTime })
      .then(refresh)
      .catch((err) => showTip(String(err)));
    closeKindPop();
  });
  pop.appendChild(ok);

  document.body.appendChild(pop);
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  pop.style.left = Math.min(r.left, window.innerWidth - 200) + "px";
  pop.style.top = Math.min(r.bottom + 4, window.innerHeight - 200) + "px";

  setTimeout(() => document.addEventListener("mousedown", onOutside), 0);
}

function onOutside(e: MouseEvent): void {
  if (!(e.target as HTMLElement).closest(".kind-pop")) closeKindPop();
}

function closeKindPop(): void {
  document.getElementById("kind-pop")?.remove();
  document.removeEventListener("mousedown", onOutside);
}
