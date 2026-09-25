import type { StateDto } from "../main";

export function renderStats(state: StateDto): void {
  const s = state.stats;

  // ① 今日 hero：进度环
  const pct = s.today_total === 0 ? 0 : Math.round((s.today_done / s.today_total) * 100);
  const ring = document.getElementById("ring")!;
  ring.style.background = `conic-gradient(var(--accent) ${pct}%, rgba(120,150,180,0.18) 0)`;
  document.getElementById("ring-num")!.textContent = `${s.today_done}/${s.today_total}`;
  const allDone = s.today_total > 0 && s.today_done === s.today_total;
  document.getElementById("hero-title")!.textContent = allDone
    ? "今天全完成了 🎉"
    : "今日完成";
  document.getElementById("hero-sub")!.textContent = allDone
    ? "干得漂亮，明天见"
    : `剩余 ${s.today_total - s.today_done} 件`;

  // ② 坚持：streak（冷启动优雅降级）
  const hasDaily = s.streak_current !== null;
  document.getElementById("streak-num")!.textContent = hasDaily
    ? `${s.streak_current} 天`
    : "—";
  document.getElementById("streak-longest")!.textContent = hasDaily
    ? `${s.streak_longest ?? 0} 天`
    : "—";

  // 热力图（全任务口径；未使用的日子留空格）
  const hm = document.getElementById("heatmap")!;
  hm.textContent = "";
  const loggedDays = s.heatmap.filter((d) => d.total > 0).length;
  for (const day of s.heatmap) {
    const cell = document.createElement("div");
    cell.className = "hm-cell";
    if (day.total === 0) {
      cell.classList.add("hm-empty");
    } else {
      const ratio = day.done / day.total;
      if (ratio >= 1) cell.classList.add("hm-full");
      else if (ratio >= 0.5) cell.classList.add("hm-mid");
      else cell.classList.add("hm-low");
    }
    cell.title = `${day.date}：${day.done}/${day.total}`;
    hm.appendChild(cell);
  }
  document.getElementById("heatmap-note")!.textContent =
    loggedDays === 0
      ? "刚开始记录，坚持几天这里会越来越好看"
      : `已记录 ${loggedDays} 天`;

  // ③ 分类完成率
  fillBar("bar-daily", "rate-daily", s.rate_daily);
  fillBar("bar-limited", "rate-limited", s.rate_limited);
  fillBar("bar-open", "rate-open", s.rate_open);

  // 任务健康：按期完成率 + 积压告警
  fillBar("bar-ontime", "rate-ontime", s.on_time_rate);
  const alert = document.getElementById("backlog-alert")!;
  if (s.backlog_count > 0) {
    alert.hidden = false;
    alert.textContent = `⚠ ${s.backlog_count} 件不限时任务已躺 ${s.oldest_backlog_days} 天——该做掉，或者删掉`;
  } else {
    alert.hidden = true;
  }
  document.getElementById("health-note")!.textContent =
    s.on_time_rate === null && s.backlog_count === 0
      ? `限时任务完成后这里会给出按期率；不限时积压 ${state.backlog_days} 天起提醒`
      : "";
}

function fillBar(barId: string, rateId: string, v: number | null): void {
  const bar = document.getElementById(barId)!;
  const label = document.getElementById(rateId)!;
  if (v === null) {
    bar.style.width = "0";
    label.textContent = "—";
  } else {
    bar.style.width = `${Math.round(v * 100)}%`;
    label.textContent = `${Math.round(v * 100)}%`;
  }
}
