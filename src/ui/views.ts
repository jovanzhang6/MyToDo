export type ViewName = "list" | "stats" | "settings" | "ball";

const VIEWS: ViewName[] = ["list", "stats", "settings", "ball"];
let viewListener: ((name: ViewName) => void) | null = null;

/** 订阅视图切换（用于懒渲染统计/设置等非活跃页面） */
export function onViewChange(cb: (name: ViewName) => void): void {
  viewListener = cb;
}

/** 四视图互斥切换（清单 / 统计 / 设置 / 悬浮球） */
export function showView(name: ViewName): void {
  for (const v of VIEWS) {
    document.getElementById(`view-${v}`)!.hidden = v !== name;
  }
  document.body.classList.toggle("ball-mode", name === "ball");
  viewListener?.(name);
}

export function currentView(): ViewName {
  for (const v of VIEWS) {
    if (!document.getElementById(`view-${v}`)!.hidden) return v;
  }
  return "list";
}
