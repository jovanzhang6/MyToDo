import { invoke } from "@tauri-apps/api/core";
import { localToday, type StateDto, type TaskView } from "../main";
import { showTip } from "./addbar";

const KIND_LABEL: Record<TaskView["kind"], string> = {
  daily: "每日",
  limited: "限时",
  open: "不限时",
};

interface RowCtrl {
  row: HTMLDivElement;
  check: HTMLInputElement;
  textEl: HTMLSpanElement;
  badge: HTMLSpanElement;
  task: TaskView;
}

const rowMap = new Map<string, RowCtrl>();
let activePopTaskId: string | null = null;
let activePopScrollHost: HTMLElement | null = null;

/** 限时任务的到期徽标文案与样式（毫秒差与后端 `due <= now` 严格对齐） */
function dueBadge(
  task: TaskView,
  today: string
): { text: string; dueToday: boolean; soon: boolean; expired: boolean } | null {
  if (task.kind !== "limited" || !task.due_date) return null;
  const hm = task.due_time ? task.due_time.slice(0, 5) : null;
  const ms = msUntil(task.due_date, task.due_time);
  const diff = daysBetween(today, task.due_date);
  if ((ms !== null && ms <= 0) || diff < 0) {
    return { text: "已到期", dueToday: true, soon: true, expired: true };
  }
  if (diff >= 2) {
    return {
      text: diff === 2 ? "后天到期" : `${diff}天后到期`,
      dueToday: false,
      soon: false,
      expired: false,
    };
  }
  if (diff === 1) {
    return {
      text: hm ? `明天 ${hm}` : "明天到期",
      dueToday: false,
      soon: ms !== null && ms < 15 * 60_000,
      expired: false,
    };
  }
  return {
    text: hm ? `今天 ${hm}` : "今天到期",
    dueToday: true,
    soon: ms !== null && ms < 15 * 60_000,
    expired: false,
  };
}

/** 距到期毫秒数（本地时钟，仅展示；过期归档由后端裁决）。天粒度任务返回 null */
function msUntil(dueDate: string, dueTime: string | null): number | null {
  if (!dueTime) return null;
  const t = new Date(`${dueDate}T${dueTime.slice(0, 5)}:00`);
  if (isNaN(t.getTime())) return null;
  return t.getTime() - Date.now();
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** 按 task.id 复用并最小化重排 DOM：保住滚动位置，绝不打断正在进行的行内编辑 */
export function renderList(root: HTMLElement, state: StateDto): void {
  const prevScroll = root.scrollTop;
  if (state.tasks.length === 0) {
    closeKindPop();
    rowMap.clear();
    if (!(root.firstElementChild?.id === "empty-tip" && root.children.length === 1)) {
      root.textContent = "";
      const tip = document.createElement("div");
      tip.id = "empty-tip";
      tip.textContent = "还没有任务\n在下方输入，回车添加";
      root.appendChild(tip);
    }
    return;
  }

  const emptyEl = document.getElementById("empty-tip");
  if (emptyEl && emptyEl.parentElement === root) {
    emptyEl.remove();
  }

  const liveIds = new Set(state.tasks.map((t) => t.id));
  for (const [id, ctrl] of rowMap) {
    if (!liveIds.has(id)) {
      ctrl.row.remove();
      rowMap.delete(id);
    }
  }
  if (activePopTaskId && !liveIds.has(activePopTaskId)) {
    closeKindPop();
  }

  for (let i = 0; i < state.tasks.length; i++) {
    const task = state.tasks[i];
    let ctrl = rowMap.get(task.id);
    if (!ctrl) {
      ctrl = createRow(task);
      rowMap.set(task.id, ctrl);
    }
    syncRow(ctrl, task, state.today);
    const expected = root.children[i] ?? null;
    if (expected !== ctrl.row) {
      root.insertBefore(ctrl.row, expected);
    }
  }
  root.scrollTop = prevScroll;
}

/** 纯前端刷新限时徽标与紧急脉动状态；若发现有未完成任务跨过到期线则通知调用方触发后端归档 */
export function updateDueBadges(today: string): boolean {
  let hasNewlyExpired = false;
  for (const ctrl of rowMap.values()) {
    if (ctrl.task.kind !== "limited") continue;
    const due = applyBadge(ctrl.badge, ctrl.task, today);
    if (due?.expired && !ctrl.task.done) {
      hasNewlyExpired = true;
    }
  }
  return hasNewlyExpired;
}

function createRow(initial: TaskView): RowCtrl {
  const row = document.createElement("div");
  row.dataset.id = initial.id;

  const check = document.createElement("input");
  check.type = "checkbox";
  check.title = "完成 / 取消完成";

  const textEl = document.createElement("span");
  textEl.className = "task-text";
  textEl.title = "双击编辑";

  const badge = document.createElement("span");

  const del = document.createElement("button");
  del.className = "task-del";
  del.textContent = "×";
  del.title = "删除";

  const ctrl: RowCtrl = { row, check, textEl, badge, task: initial };

  check.addEventListener("change", () => {
    const next = check.checked;
    invoke("toggle_done", { id: ctrl.task.id }).catch((e) => {
      check.checked = !next;
      showTip(String(e));
    });
  });

  textEl.addEventListener("dblclick", () => beginEdit(ctrl));
  badge.addEventListener("click", (e) => openKindPop(e, ctrl));
  del.addEventListener("click", () =>
    invoke("delete_task", { id: ctrl.task.id }).catch((e) => showTip(String(e)))
  );

  row.append(check, textEl, badge, del);
  return ctrl;
}

function syncRow(ctrl: RowCtrl, task: TaskView, today: string): void {
  ctrl.task = task;
  const rowCls = "task-row" + (task.done ? " done" : "");
  if (ctrl.row.className !== rowCls) ctrl.row.className = rowCls;
  if (ctrl.check.checked !== task.done) ctrl.check.checked = task.done;
  // 行内编辑中不动输入框，防止后台轮询/聚焦刷新吞掉用户正在打的字
  if (ctrl.row.dataset.editing !== "1" && ctrl.textEl.textContent !== task.text) {
    ctrl.textEl.textContent = task.text;
  }
  applyBadge(ctrl.badge, task, today);
}

function applyBadge(
  badge: HTMLSpanElement,
  task: TaskView,
  today: string
): ReturnType<typeof dueBadge> {
  const baseCls = "badge " + task.kind;
  if (task.kind !== "limited") {
    if (badge.className !== baseCls) badge.className = baseCls;
    const label = KIND_LABEL[task.kind];
    if (badge.textContent !== label) badge.textContent = label;
    return null;
  }
  const due = dueBadge(task, today);
  const label = due ? `${KIND_LABEL.limited} · ${due.text}` : KIND_LABEL.limited;
  const cls =
    baseCls +
    (due?.dueToday ? " due-today" : "") +
    (due?.soon ? " due-now" : "");
  if (badge.className !== cls) badge.className = cls;
  if (badge.textContent !== label) badge.textContent = label;
  return due;
}

/** 行内编辑：双击文字 → 输入框，Enter/失焦提交，Esc 原地恢复（无多余 IPC） */
function beginEdit(ctrl: RowCtrl): void {
  if (ctrl.row.dataset.editing === "1") return;
  ctrl.row.dataset.editing = "1";

  const original = ctrl.task.text;
  const input = document.createElement("input");
  input.className = "edit-input";
  input.maxLength = 200;
  input.value = original;
  ctrl.textEl.replaceWith(input);
  ctrl.badge.hidden = true;
  input.focus();
  input.select();

  let finished = false;
  const finish = (save: boolean) => {
    if (finished) return;
    finished = true;
    ctrl.row.dataset.editing = "";
    const value = input.value.trim();
    input.replaceWith(ctrl.textEl);
    ctrl.badge.hidden = false;

    if (save && value && value !== ctrl.task.text) {
      ctrl.textEl.textContent = value;
      invoke("edit_text", { id: ctrl.task.id, text: value }).catch((e) => {
        ctrl.textEl.textContent = ctrl.task.text;
        showTip(String(e));
      });
    } else {
      ctrl.textEl.textContent = ctrl.task.text;
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

/** 类型修改气泡：三类互转；选限时自动展示/预填日期与时刻；支持 Esc 与滚动自动关闭 */
function openKindPop(e: MouseEvent, ctrl: RowCtrl): void {
  e.stopPropagation();
  closeKindPop();

  const task = ctrl.task;
  activePopTaskId = task.id;
  activePopScrollHost = document.getElementById("list");

  const pop = document.createElement("div");
  pop.id = "kind-pop";
  pop.className = "kind-pop";

  const dueRow = document.createElement("div");
  dueRow.className = "pop-due";

  const due = document.createElement("input");
  due.type = "date";
  due.value = task.due_date ?? "";

  const dueT = document.createElement("input");
  dueT.type = "time";
  dueT.value = task.due_time ? task.due_time.slice(0, 5) : "";

  dueRow.append(due, dueT);

  const syncDueVisibility = (k: TaskView["kind"]) => {
    const isLimited = k === "limited";
    dueRow.hidden = !isLimited;
    if (isLimited) {
      if (!due.value) due.value = localToday();
      if (!dueT.value) dueT.value = "23:59";
    }
  };

  const mk = (value: TaskView["kind"], label: string) => {
    const labelEl = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "pop-kind";
    radio.value = value;
    radio.checked = task.kind === value;
    radio.addEventListener("change", () => syncDueVisibility(value));
    labelEl.append(radio, document.createTextNode(label));
    return labelEl;
  };
  pop.append(mk("open", "不限时"), mk("daily", "每日"), mk("limited", "限时（需日期）"));
  pop.appendChild(dueRow);
  syncDueVisibility(task.kind);

  const ok = document.createElement("button");
  ok.className = "pop-ok";
  ok.textContent = "确认";
  ok.addEventListener("click", () => {
    const kind = (pop.querySelector<HTMLInputElement>('[name="pop-kind"]:checked')?.value ??
      task.kind) as TaskView["kind"];
    const dueDate = kind === "limited" ? due.value || null : null;
    const dueTime = kind === "limited" ? dueT.value || null : null;
    invoke("set_kind", { id: task.id, kind, dueDate, dueTime }).catch((err) =>
      showTip(String(err))
    );
    closeKindPop();
  });
  pop.appendChild(ok);

  document.body.appendChild(pop);
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - pop.offsetWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - pop.offsetHeight - 8);
  pop.style.left = Math.min(Math.max(8, r.left), maxLeft) + "px";
  pop.style.top = Math.min(Math.max(8, r.bottom + 4), maxTop) + "px";

  setTimeout(() => document.addEventListener("mousedown", onOutside), 0);
  document.addEventListener("keydown", onPopEscape);
  activePopScrollHost?.addEventListener("scroll", closeKindPop, { passive: true });
}

function onOutside(e: MouseEvent): void {
  if (!(e.target as HTMLElement).closest(".kind-pop")) closeKindPop();
}

function onPopEscape(e: KeyboardEvent): void {
  if (e.key === "Escape") closeKindPop();
}

function closeKindPop(): void {
  document.getElementById("kind-pop")?.remove();
  document.removeEventListener("mousedown", onOutside);
  document.removeEventListener("keydown", onPopEscape);
  activePopScrollHost?.removeEventListener("scroll", closeKindPop);
  activePopScrollHost = null;
  activePopTaskId = null;
}
