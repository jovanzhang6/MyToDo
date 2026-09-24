import type { StateDto } from "../main";

/** 统计面板：从 StateDto.stats 填充（声明式 DOM，hidden 切换） */
export function initStatsPanel(): void {
  document.getElementById("btn-stats")!.addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = document.getElementById("stats-panel")!;
    panel.hidden = !panel.hidden;
    // 面板与设置气泡互斥，避免叠加
    if (!panel.hidden) document.getElementById("settings-pop")!.hidden = true;
  });
  document.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    const panel = document.getElementById("stats-panel")!;
    if (!panel.hidden && !t.closest("#stats-panel") && !t.closest("#btn-stats")) {
      panel.hidden = true;
    }
  });
}

export function renderStats(state: StateDto): void {
  const s = state.stats;
  document.getElementById("stat-today")!.textContent = `${s.today_done} / ${s.today_total}`;
  const pct = (v: number | null) =>
    v === null ? "—" : `${Math.round(v * 100)}%`;
  document.getElementById("stat-daily")!.textContent = pct(s.rate_daily);
  document.getElementById("stat-limited")!.textContent = pct(s.rate_limited);
  document.getElementById("stat-open")!.textContent = pct(s.rate_open);
  document.getElementById("stat-streak")!.textContent =
    s.streak === null ? "—" : `${s.streak} 天`;
  document.getElementById("stat-archive")!.textContent = String(s.archive_count);

  // 近 30 天趋势：纯 div 条形（有日志的天画柱，无日志留空）
  const trend = document.getElementById("stat-trend")!;
  trend.textContent = "";
  const max = Math.max(1, ...s.trend.map((t) => t.total));
  for (const day of s.trend) {
    const bar = document.createElement("div");
    bar.className = "bar";
    if (day.total > 0) {
      const ratio = day.done / max;
      bar.style.height = `${Math.max(8, Math.round(ratio * 100))}%`;
      if (day.total > 0 && day.done === day.total) bar.classList.add("full");
      bar.title = `${day.date}：${day.done}/${day.total}`;
    } else {
      bar.style.height = "10%";
      bar.title = `${day.date}：无每日任务记录`;
    }
    trend.appendChild(bar);
  }
}
