export type ViewName = "list" | "stats" | "settings" | "ball";

const VIEWS: ViewName[] = ["list", "stats", "settings", "ball"];

/** 四视图互斥切换（清单 / 统计 / 设置 / 悬浮球） */
export function showView(name: ViewName): void {
  for (const v of VIEWS) {
    document.getElementById(`view-${v}`)!.hidden = v !== name;
  }
  document.body.classList.toggle("ball-mode", name === "ball");
}

export function currentView(): ViewName {
  for (const v of VIEWS) {
    if (!document.getElementById(`view-${v}`)!.hidden) return v;
  }
  return "list";
}
