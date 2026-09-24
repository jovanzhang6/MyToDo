export type ViewName = "list" | "stats" | "settings";

const VIEWS: ViewName[] = ["list", "stats", "settings"];

/** 三视图互斥切换（清单 / 统计 / 设置） */
export function showView(name: ViewName): void {
  for (const v of VIEWS) {
    document.getElementById(`view-${v}`)!.hidden = v !== name;
  }
}

export function currentView(): ViewName {
  for (const v of VIEWS) {
    if (!document.getElementById(`view-${v}`)!.hidden) return v;
  }
  return "list";
}
