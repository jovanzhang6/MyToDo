import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/* ============================================================
   MyToDo 宣传片 v5 —— 「真实界面」
   原则：画面里的每一个像素都来自 styles.css 的真实值。
   一块 300×520 的磨砂玻璃小窗按 1.7 倍浮在苹果式浅灰舞台
   上，光标完成全部操作：输入回车加任务、选限时刻 +1天、
   勾选沉底、收球贴边、悬停展开、切统计页。无配乐。
   ============================================================ */

/* ── 真实 UI 色板（styles.css 原值） ── */
const ACCENT = "#3d8bd4";
const INK = "#1c2b3a";
const DIM = "#5b7189";
const GLASS = "rgba(235,245,253,0.88)";
const ROW_BG = "rgba(255,255,255,0.46)";
const ROW_BORDER = "rgba(130,160,190,0.18)";
const CARD_BG = "rgba(255,255,255,0.5)";
const CARD_BORDER = "rgba(130,160,190,0.18)";
const TRACK = "rgba(120,150,180,0.15)";
const AMBER_C = "#a06a1c";
const AMBER_BG = "rgba(212,150,61,0.16)";
const GREEN = "#58a942";

/* ── 苹果式舞台 ── */
const STAGE = "#f5f5f7";
const A_INK = "#1d1d1f";
const A_DIM = "#86868b";

const SANS = `"Segoe UI", "Microsoft YaHei", system-ui, sans-serif`;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeIO = Easing.inOut(Easing.cubic);
const easeOut = Easing.out(Easing.cubic);

/* ── 几何常量 ──
   小窗 300×520（styles.css 真实逻辑尺寸），片内放大 WS 倍 */
const WS = 1.85;
const OY = Math.round((1080 - 520 * WS) / 2); // 窗顶（垂直居中）
const ROW_H = 38; // 行高 34 + margin 4
const LIST_TOP = 40;

/* 事件帧 */
const T_TYPE = 106; // 开始输入
const T_KIND = 152; // 点「限时」
const T_PLUS1 = 158; // 点「+1天」×2
const T_ADD = 176; // 点 ✓ 添加（A1）
const T_CHECK1 = 240; // 勾选 A
const T_CHECK2 = 286; // 勾选 D（晨间拉伸·每日）
const T_RESET = 320; // 跨天演示：日期翻页，每日任务自动重来
const T_BALL = 386; // 点标题栏 ◎（光标 378 到位、停 8 帧再点）
const T_HOVER = 480; // 悬停球滑出
const T_EXPAND = 500; // 点球展开
const T_STATS = 540; // 点 📊
const T_END = 630; // 收尾

/* ── 工具 ── */
const guardedSpring = (
  t: number,
  at: number,
  fps: number,
  damping = 16,
  stiffness = 110
) => (t <= at ? 0 : spring({ frame: t - at, fps, config: { damping, stiffness } }));

const fx = (ix: number, ox: number) => ox + ix * WS;
const fy = (iy: number) => OY + iy * WS;

/* ── 光标（macOS 式黑箭头） ── */
type Seg = [number, number, number, number, number, number];
const CURSOR_SEGS: Seg[] = [
  // t0,x0,y0 → t1,x1,y1（帧坐标）
  [60, 1560, 1180, 100, fx(140, 235), fy(492)],
  [140, fx(140, 235), fy(492), 150, fx(149, 235), fy(433)],
  [150, fx(149, 235), fy(433), 158, fx(170, 235), fy(459)],
  [158, fx(170, 235), fy(459), 166, fx(170, 235), fy(459)],
  [166, fx(170, 235), fy(459), 174, fx(273, 235), fy(492)],
  [186, fx(273, 235), fy(492), 208, fx(300, 235), fy(560)],
  [218, fx(300, 235), fy(560), 234, fx(17, 235), fy(58)],
  [260, fx(17, 235), fy(58), 278, fx(17, 235), fy(134)],
  [296, fx(17, 235), fy(134), 312, fx(60, 235), fy(210)],
  [312, fx(60, 235), fy(210), 366, fx(60, 235), fy(210)],
  [366, fx(60, 235), fy(210), 378, fx(173, 235), fy(19)],
  [378, fx(173, 235), fy(19), 390, fx(173, 235), fy(19)],
  [390, fx(173, 235), fy(19), 434, 1830, 520],
  [434, 1830, 520, 470, 2082, 540],
  [470, 2082, 540, 500, 2082, 540],
  [502, 2082, 540, 522, fx(199, 235), fy(19)],
  [522, fx(199, 235), fy(19), 544, fx(199, 235), fy(19)],
  [544, fx(199, 235), fy(19), 562, fx(230, 235), fy(60)],
];
const CLICKS = [102, 152, 158, 166, 176, 240, 286, 386, 500, 540];

const cursorPos = (t: number): [number, number] => {
  /* 段间空隙 = 原地停顿：必须停在上一段终点；若误返回全片终点，光标会瞬移到右上角乱点 */
  let pos: [number, number] = [CURSOR_SEGS[0][1], CURSOR_SEGS[0][2]];
  for (const s of CURSOR_SEGS) {
    if (t < s[0]) break;
    if (t <= s[3]) {
      const p = interpolate(t, [s[0], s[3]], [0, 1], { ...clamp, easing: easeIO });
      pos = [s[1] + (s[4] - s[1]) * p, s[2] + (s[5] - s[2]) * p];
    } else {
      pos = [s[4], s[5]];
    }
  }
  return pos;
};

const Cursor: React.FC<{ f: number }> = ({ f }) => {
  const [x, y] = cursorPos(f);
  const opacity = interpolate(f, [56, 64, 560, 576], [0, 1, 1, 0], clamp);
  let press = 0;
  for (const c of CLICKS) {
    const a = f - c;
    if (a >= 0 && a < 8) press = Math.max(press, 1 - a / 8);
  }
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity }}>
      {CLICKS.map((c, i) => {
        const age = f - c;
        if (age < 0 || age > 16) return null;
        const [cx, cy] = cursorPos(c);
        const p = age / 16;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx - 14 - p * 16,
              top: cy - 14 - p * 16,
              width: 28 + p * 32,
              height: 28 + p * 32,
              borderRadius: "50%",
              border: `2px solid rgba(61,139,212,${0.55 * (1 - p)})`,
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          transform: `scale(${1 - press * 0.18})`,
          transformOrigin: "2px 2px",
          filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.25))",
        }}
      >
        <svg width="23" height="26" viewBox="0 0 23 26">
          <path
            d="M4 1.5 L4 20.5 L8.9 16.4 L11.8 23.2 L15.4 21.6 L12.5 15 L19 14.4 Z"
            fill="#151515"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
};

/* ── 悬浮球（ball-window 真实样式） ── */
const BallDisc: React.FC<{
  x: number;
  y: number;
  size: number;
  pct: number;
  count: string;
  opacity: number;
}> = ({ x, y, size, pct, count, opacity }) => (
  <div
    style={{
      position: "absolute",
      left: x - size / 2,
      top: y - size / 2,
      width: size,
      height: size,
      borderRadius: "50%",
      background: `conic-gradient(rgba(255,255,255,0.92) ${pct}%, transparent 0), linear-gradient(160deg, #6aa7dd 0%, #3d7fc0 100%)`,
      boxShadow: "0 18px 44px rgba(61,127,192,0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      opacity,
    }}
  >
    <div
      style={{
        width: "72%",
        height: "72%",
        borderRadius: "50%",
        background: "rgba(21,48,78,0.88)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      <span
        style={{
          fontSize: size * 0.2,
          fontWeight: 700,
          lineHeight: 1,
          color: "#fff",
          fontFamily: SANS,
        }}
      >
        {count}
      </span>
      <small
        style={{
          fontSize: size * 0.11,
          color: "rgba(255,255,255,0.75)",
          lineHeight: 1,
          fontFamily: SANS,
        }}
      >
        待办
      </small>
    </div>
  </div>
);

/* ── 标题栏图标（index.html 原版 SVG） ── */
const TB_ICONS: Record<string, React.ReactNode> = {
  ball: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  stats: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M4 7h8M18 7h2M4 17h2M12 17h8" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="9" cy="17" r="2.5" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16.5V21" />
      <path d="M9 3.5h6l-.8 6.8 2.8 2.9v1.8H7v-1.8l2.8-2.9L9 3.5z" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
};

/* ── 任务行 ── */
const TaskRow: React.FC<{
  slotY: number;
  text: string;
  badge: string;
  badgeClass: "open" | "daily" | "limited";
  doneAt: number; // <0 表示未勾选
  undoneAt?: number; // >=0 时该帧起自动取消勾选（每日任务跨天重来）
  t: number;
  fps: number;
  appearAt: number; // <0 无出场动画
}> = ({ slotY, text, badge, badgeClass, doneAt, undoneAt = -1, t, fps, appearAt }) => {
  const done = doneAt >= 0 && t >= doneAt && !(undoneAt >= 0 && t >= undoneAt);
  const pop = done ? Math.max(guardedSpring(t, doneAt, fps, 12, 200), 0.001) : 1;
  const strike = done
    ? interpolate(t, [doneAt + 3, doneAt + 14], [0, 1], { ...clamp, easing: easeOut })
    : 0;
  /* 跨天重置：勾选块回弹、划线淡出 */
  const resetPop = undoneAt >= 0 && t >= undoneAt ? spring({ frame: t - undoneAt, fps, config: { damping: 14, stiffness: 180 } }) : 0;
  const boxScale = done ? pop : resetPop > 0 ? 1 + Math.sin(Math.min(resetPop * Math.PI, Math.PI)) * 0.18 : 1;
  const strikeFade = !done && undoneAt >= 0 && t >= undoneAt ? 1 - interpolate(t, [undoneAt, undoneAt + 10], [0, 1], clamp) : 1;
  const appear =
    appearAt >= 0 ? interpolate(t, [appearAt, appearAt + 14], [0, 1], { ...clamp, easing: easeOut }) : 1;
  const badgeStyle: React.CSSProperties =
    badgeClass === "daily"
      ? { background: "rgba(61,139,212,0.15)", color: ACCENT }
      : badgeClass === "limited"
        ? { background: AMBER_BG, color: AMBER_C }
        : { background: "rgba(120,150,180,0.14)", color: DIM };
  return (
    <div
      style={{
        position: "absolute",
        left: 8,
        right: 8,
        top: slotY,
        height: 34,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 8px",
        borderRadius: 8,
        background: done ? "rgba(255,255,255,0.22)" : ROW_BG,
        border: `1px solid ${done ? "rgba(130,160,190,0.1)" : ROW_BORDER}`,
        fontFamily: SANS,
        opacity: appear,
      }}
    >
      {/* 复选框（原生 15px accent 蓝） */}
      <div
        style={{
          width: 15,
          height: 15,
          flex: "none",
          borderRadius: 3,
          background: done ? ACCENT : "rgba(255,255,255,0.95)",
          border: done ? `1px solid ${ACCENT}` : "1px solid #93a7bb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${boxScale})`,
        }}
      >
        {done && (
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 12.8l4.6 4.4L19.5 7.2" />
          </svg>
        )}
      </div>
      <div style={{ position: "relative", flex: 1, fontSize: 13, lineHeight: 1.4, color: done ? "#46586c" : INK }}>
        {text}
        {(done || strikeFade > 0) && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: "52%",
              height: 2.2,
              width: `${strike * 100}%`,
              background: "#223247",
              opacity: strikeFade,
            }}
          />
        )}
      </div>
      <span
        style={{
          flex: "none",
          fontSize: 11,
          borderRadius: 5,
          padding: "2px 6px",
          border: "1px solid transparent",
          ...badgeStyle,
        }}
      >
        {badge}
      </span>
      <span style={{ flex: "none", color: "rgba(91,113,137,0.4)", fontSize: 14, width: 14, textAlign: "center" }}>
        ×
      </span>
    </div>
  );
};

/* ── 清单视图（view-list） ── */
const ListView: React.FC<{ t: number; fps: number; visible: boolean }> = ({ t, fps, visible }) => {
  /* 行序账本：base + Σ Δ·spring */
  const A1 = T_ADD;
  const rowDefs = [
    { key: "A", text: "交季度报告", badge: "限时 · 后天到期", cls: "limited" as const, base: -1,
      steps: [{ at: A1, d: 1 }, { at: T_CHECK1, d: 4 }, { at: T_CHECK2, d: -1 }, { at: T_RESET, d: 1 }],
      doneAt: T_CHECK1, undoneAt: -1, appear: A1 },
    { key: "B", text: "整理灵感清单", badge: "不限时", cls: "open" as const, base: 0,
      steps: [{ at: A1, d: 1 }, { at: T_CHECK1, d: -1 }], doneAt: -1, undoneAt: -1, appear: -1 },
    { key: "C", text: "回复客户邮件", badge: "不限时", cls: "open" as const, base: 1,
      steps: [{ at: A1, d: 1 }, { at: T_CHECK1, d: -1 }], doneAt: -1, undoneAt: -1, appear: -1 },
    { key: "D", text: "晨间拉伸", badge: "每日", cls: "daily" as const, base: 2,
      steps: [{ at: A1, d: 1 }, { at: T_CHECK1, d: -1 }, { at: T_CHECK2, d: 2 }, { at: T_RESET, d: -2 }],
      doneAt: T_CHECK2, undoneAt: T_RESET, appear: -1 },
    { key: "E", text: "夜间复盘", badge: "每日", cls: "daily" as const, base: 3,
      steps: [{ at: A1, d: 1 }, { at: T_CHECK1, d: -1 }, { at: T_CHECK2, d: -1 }, { at: T_RESET, d: 1 }],
      doneAt: -1, undoneAt: -1, appear: -1 },
  ];
  const typed =
    t < T_ADD
      ? "交季度报告".slice(0, Math.max(0, Math.min(5, Math.floor((t - T_TYPE) / 5))))
      : "";
  const caretOn = t >= T_TYPE && t < T_ADD && Math.floor(t / 8) % 2 === 0;
  const limited = t >= T_KIND;
  const plus = t >= T_PLUS1 ? (t >= T_PLUS1 + 8 ? 2 : 1) : 0;
  const dueDate = `2026-10-0${4 + plus}`;
  const added = t >= T_ADD;

  return (
    <div style={{ position: "absolute", inset: 0, opacity: visible ? 1 : 0 }}>
      <main style={{ position: "absolute", top: 38, left: 0, right: 0, bottom: limited ? 106 : 78, overflow: "hidden" }}>
        {rowDefs.map((r) => {
          const slot =
            r.base + r.steps.reduce((acc, s) => acc + s.d * guardedSpring(t, s.at, fps), 0);
          const badge =
            r.key === "A"
              ? t >= T_RESET
                ? "限时 · 明天到期"
                : "限时 · 后天到期"
              : r.badge;
          return (
            <TaskRow
              key={r.key}
              slotY={4 + slot * ROW_H}
              text={r.text}
              badge={badge}
              badgeClass={r.cls}
              doneAt={r.doneAt}
              undoneAt={r.undoneAt}
              appearAt={r.appear}
              t={t}
              fps={fps}
            />
          );
        })}
      </main>
      {/* 添加条 footer#addbar */}
      <footer
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: limited ? 106 : 78,
          padding: "8px 10px 10px",
          borderTop: "1px solid rgba(255,255,255,0.5)",
        }}
      >
        {/* 类型胶囊组 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6, fontSize: 12 }}>
          {[
            { label: "不限时", on: !limited },
            { label: "每日", on: false },
            { label: "限时", on: limited },
          ].map((k) => (
            <span
              key={k.label}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 10px",
                borderRadius: 999,
                background: k.on ? ACCENT : "rgba(255,255,255,0.42)",
                border: `1px solid ${k.on ? ACCENT : "rgba(120,150,180,0.28)"}`,
                color: k.on ? "#fff" : DIM,
                fontFamily: SANS,
              }}
            >
              {k.label}
            </span>
          ))}
          {limited && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 4, whiteSpace: "nowrap" }}>
              <span style={{ color: DIM, fontSize: 12, fontFamily: SANS }}>截止</span>
              <span
                style={{
                  width: 84,
                  textAlign: "center",
                  border: "1px solid rgba(120,150,180,0.4)",
                  borderRadius: 999,
                  fontSize: 11,
                  padding: "2px 6px",
                  background: "rgba(255,255,255,0.8)",
                  color: INK,
                  fontFamily: SANS,
                }}
              >
                {dueDate}
              </span>
              <span
                style={{
                  border: "none",
                  background: "rgba(120,150,180,0.14)",
                  color: DIM,
                  borderRadius: 999,
                  fontSize: 11,
                  padding: "2px 8px",
                  fontFamily: SANS,
                }}
              >
                +1天
              </span>
            </span>
          )}
        </div>
        {/* 输入行 */}
        <div style={{ display: "flex", gap: 6 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              border: `1px solid ${t >= T_TYPE - 4 && t < T_ADD + 6 ? ACCENT : "rgba(120,150,180,0.35)"}`,
              borderRadius: 8,
              background: t >= T_TYPE - 4 && t < T_ADD + 6 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.65)",
              padding: "7px 10px",
              fontSize: 13,
              color: INK,
              fontFamily: SANS,
              height: 32,
            }}
          >
            {typed}
            {caretOn && <span style={{ color: ACCENT }}>|</span>}
            {!typed && t < T_TYPE && (
              <span style={{ color: DIM }}>要做点什么？回车添加</span>
            )}
          </div>
          <div
            style={{
              flex: "none",
              width: 34,
              height: 32,
              borderRadius: 8,
              background: ACCENT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              filter: t >= T_ADD - 2 && t < T_ADD + 6 ? "brightness(1.15)" : "none",
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 12.8l4.6 4.4L19.5 7.2" />
            </svg>
          </div>
        </div>
      </footer>
    </div>
  );
};

/* ── 统计视图（view-stats，数据与勾选剧情一致：3/5） ── */
const StatsView: React.FC<{ t: number; fps: number; visible: boolean }> = ({ t, fps, visible }) => {
  const st = t - T_STATS; // 视图内年龄
  const cellCls = (i: number) => {
    const pat = [0, 2, 1, 3, 2, 0, 1, 3, 3, 2, 1, 2, 0, 3, 2, 1, 3, 2, 3, 1, 2, 3, 0, 2, 3, 3, 1, 2, 3, 3];
    return pat[i % 30];
  };
  const hmIn = (i: number) => interpolate(st, [10 + i * 0.7, 16 + i * 0.7], [0, 1], clamp);
  const barW = (v: number, at: number) => interpolate(st, [at, at + 16], [0, v], { ...clamp, easing: easeOut });
  const ringDeg = interpolate(st, [4, 26], [0, 60], { ...clamp, easing: easeOut });
  const card = (i: number) => ({
    opacity: interpolate(st, [2 + i * 3, 8 + i * 3], [0, 1], clamp),
    transform: `translateY(${(1 - interpolate(st, [2 + i * 3, 8 + i * 3], [0, 1], { ...clamp, easing: easeOut })) * 10}px)`,
  });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 38, opacity: visible ? 1 : 0, fontFamily: SANS }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 2px", fontSize: 13, color: INK }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: DIM,
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </span>
        <b>统计</b>
      </header>
      <div style={{ position: "absolute", top: 36, left: 0, right: 0, bottom: 0, padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
        {/* hero */}
        <section style={{ ...card(0), background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              position: "relative",
              width: 64,
              height: 64,
              borderRadius: "50%",
              flex: "none",
              background: `conic-gradient(${ACCENT} ${ringDeg}%, rgba(120,150,180,0.18) 0)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ position: "absolute", width: 50, height: 50, borderRadius: "50%", background: "rgba(250,253,255,0.95)" }} />
            <span style={{ position: "relative", fontSize: 13, fontWeight: 600, color: INK }}>3/5</span>
          </div>
          <div>
            <b style={{ display: "block", fontSize: 15, color: INK }}>今日完成</b>
            <small style={{ color: DIM, fontSize: 12 }}>剩余 2 件</small>
          </div>
        </section>
        {/* streak */}
        <section style={{ ...card(1), background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontSize: 24, fontWeight: 700, color: ACCENT }}>21 天</span>
            <small style={{ color: DIM, fontSize: 12, marginLeft: 6 }}>连续打卡</small>
          </div>
          <div style={{ color: DIM, fontSize: 12 }}>
            最长纪录 <b style={{ color: INK }}>34 天</b>
          </div>
        </section>
        {/* 热力图 */}
        <section style={{ ...card(2), background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "10px 12px" }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: DIM, marginBottom: 8 }}>近 30 天</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(15, 1fr)", gap: 3 }}>
            {Array.from({ length: 30 }).map((_, i) => {
              const c = cellCls(i);
              const bg =
                c === 0
                  ? "rgba(120,150,180,0.12)"
                  : c === 1
                    ? "rgba(61,139,212,0.3)"
                    : c === 2
                      ? "rgba(61,139,212,0.6)"
                      : ACCENT;
              return (
                <div
                  key={i}
                  style={{
                    aspectRatio: "1",
                    borderRadius: 3,
                    background: bg,
                    opacity: hmIn(i),
                    transform: `scale(${hmIn(i)})`,
                  }}
                />
              );
            })}
          </div>
          <small style={{ color: DIM, fontSize: 11, display: "block", marginTop: 6 }}>已记录 26 天</small>
        </section>
        {/* 分类完成率 */}
        <section style={{ ...card(3), background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "10px 12px" }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: DIM, marginBottom: 2 }}>分类完成率（今日）</h3>
          {[
            { label: "每日", v: 50, at: 14 },
            { label: "限时", v: 100, at: 18 },
            { label: "不限时", v: 67, at: 22 },
          ].map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12, color: DIM }}>
              <span style={{ flex: "none", width: 52 }}>{r.label}</span>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: TRACK, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${barW(r.v, r.at)}%`, borderRadius: 3, background: ACCENT }} />
              </div>
              <b style={{ flex: "none", width: 38, textAlign: "right", color: INK }}>{Math.round(barW(r.v, r.at))}%</b>
            </div>
          ))}
        </section>
        {/* 任务健康 */}
        <section style={{ ...card(4), background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "10px 12px" }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: DIM, marginBottom: 2 }}>任务健康</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12, color: DIM }}>
            <span style={{ flex: "none", width: 62 }}>按期完成率</span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: TRACK, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${barW(92, 26)}%`, borderRadius: 3, background: GREEN }} />
            </div>
            <b style={{ flex: "none", width: 38, textAlign: "right", color: INK }}>{Math.round(barW(92, 26))}%</b>
          </div>
        </section>
      </div>
      {/* 占位：fps 引用避免未使用告警 */}
      <span style={{ display: "none" }}>{fps}</span>
    </div>
  );
};

/* ── 小窗（300×520，全部真实样式值） ── */
const Widget: React.FC<{
  t: number;
  fps: number;
  ox: number;
  oy: number;
  scale: number;
  opacity: number;
  showStats: boolean;
}> = ({ t, fps, ox, oy, scale, opacity, showStats }) => (
  <div
    style={{
      position: "absolute",
      left: ox,
      top: oy,
      width: 300,
      height: 520,
      transform: `scale(${scale})`,
      transformOrigin: "0 0",
      opacity,
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: GLASS,
        border: "1px solid rgba(255,255,255,0.6)",
        borderRadius: 8,
        boxShadow: "0 8px 32px rgba(80,120,180,0.25), 0 40px 90px rgba(80,120,180,0.22)",
        overflow: "hidden",
      }}
    >
      {/* 标题栏 */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 38, padding: "0 10px" }}>
        <span style={{ position: "relative", fontWeight: 600, letterSpacing: 0.5, color: DIM, fontSize: 13, fontFamily: SANS }}>
          <span style={{ opacity: t < T_RESET ? 1 : 0 }}>10月4日 周日</span>
          <span
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              opacity: t >= T_RESET ? interpolate(t, [T_RESET, T_RESET + 8], [0, 1], clamp) : 0,
              transform: `translateY(${t >= T_RESET ? (1 - interpolate(t, [T_RESET, T_RESET + 8], [0, 1], { ...clamp, easing: easeOut })) * 8 : 8}px)`,
            }}
          >
            10月5日 周一
          </span>
        </span>
        <span style={{ display: "flex" }}>
          {(["ball", "stats", "settings", "pin", "close"] as const).map((k) => (
            <span
              key={k}
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: k === "stats" && showStats ? ACCENT : DIM,
                background:
                  (k === "ball" && t >= T_BALL - 8 && t < T_BALL + 6) ||
                  (k === "stats" && t >= T_STATS - 4 && t < T_STATS + 6)
                    ? "rgba(255,255,255,0.55)"
                    : "transparent",
              }}
            >
              {TB_ICONS[k]}
            </span>
          ))}
        </span>
      </header>
      <ListView t={t} fps={fps} visible={!showStats} />
      <StatsView t={t} fps={fps} visible={showStats} />
    </div>
  </div>
);

/* ── 苹果式文案 ── */
const Caption: React.FC<{
  x: number;
  y: number;
  lines: string[];
  sub?: string;
  o: number;
  size?: number;
}> = ({ x, y, lines, sub, o, size = 58 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      fontFamily: SANS,
      opacity: o,
      transform: `translateY(${(1 - o) * 14}px)`,
    }}
  >
    {lines.map((l, i) => (
      <div key={i} style={{ fontSize: size, fontWeight: 600, color: A_INK, letterSpacing: -0.5, lineHeight: 1.24 }}>
        {l}
      </div>
    ))}
    {sub && (
      <div style={{ fontSize: 23, color: A_DIM, marginTop: 18, letterSpacing: 0.2 }}>{sub}</div>
    )}
  </div>
);

/* ============================================================ */

export const Promo: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* 小窗位置 / 缩放时间线 */
  const settleX = interpolate(f, [40, 70], [683, 235], { ...clamp, easing: easeIO });
  const homeX = f < 40 ? 683 : f < 616 ? settleX : interpolate(f, [616, 644], [235, 683], { ...clamp, easing: easeIO });

  /* 收球变形（点 ◎ 后小窗一边缩放一边随镜头飞向球的停靠点，镜头落定瞬间原位化作球；放慢节奏） */
  const morph = interpolate(f, [T_BALL + 4, T_BALL + 40], [0, 1], { ...clamp, easing: easeIO });
  const expand = interpolate(f, [T_EXPAND, T_EXPAND + 26], [0, 1], { ...clamp, easing: easeIO });
  const m = Math.min(morph, 1 - expand);
  const wScale = WS * (1 - m * 0.93);
  /* 中心锚定：窗中心从原位水平直线滑到球的停靠点（等高 540），缩放围绕中心收——杜绝向角落飞的观感 */
  const enterIn = interpolate(f, [0, 18], [0, 1], { ...clamp, easing: easeOut });
  const restCx = homeX + 150 * WS;
  const restCy = OY + (1 - enterIn) * 44 + 260 * WS;
  const cxm = restCx + m * (2143 - restCx);
  const cym = restCy + m * (540 - restCy);
  const wOx = cxm - 150 * wScale;
  const wOy = cym - 260 * wScale;
  const wOpacity =
    f < T_BALL
      ? interpolate(f, [0, 16], [0, 1], clamp)
      : f < T_EXPAND
        ? interpolate(f, [T_BALL + 32, T_BALL + 40], [1, 0], clamp)
        : interpolate(f, [T_EXPAND, T_EXPAND + 8], [0, 1], clamp);
  /* 收尾：小窗淡出 + 回中 */
  const endOut = interpolate(f, [T_END + 14, T_END + 42], [1, 0], clamp);
  const endDrift = interpolate(f, [T_END, T_END + 40], [0, 26], { ...clamp, easing: easeIO });
  const finalOpacity = wOpacity * endOut;

  /* 球时间线：镜头落定后、在小窗消失的原位（停靠点）弹出；悬停时滑出全露 */
  const ballPop = guardedSpring(f, T_BALL + 36, fps, 13, 120);
  const hoverOut = interpolate(f, [T_HOVER, T_HOVER + 16], [0, 1], { ...clamp, easing: easeIO });
  const ballX = 2143 - hoverOut * 61;
  const ballY = 540;
  const ballOpacity =
    f < T_BALL + 36 ? 0 : f < T_EXPAND ? interpolate(f, [T_BALL + 36, T_BALL + 44], [0, 1], clamp) : interpolate(f, [T_EXPAND, T_EXPAND + 8], [1, 0], clamp);
  const ballScale = 0.4 + ballPop * 0.6;

  const showStats = f >= T_STATS;

  /* 收球段 punch-in 镜头：镜头推向右缘的球，展开时拉回 */
  const camZ =
    f < 390
      ? 1
      : f < 426
        ? interpolate(f, [390, 426], [1, 1.8], { ...clamp, easing: easeIO })
        : f < 500
          ? 1.8
          : f < 528
            ? interpolate(f, [500, 528], [1.8, 1], { ...clamp, easing: easeIO })
            : 1;
  const camX =
    f < 390
      ? 0
      : f < 426
        ? interpolate(f, [390, 426], [0, -1082], { ...clamp, easing: easeIO })
        : f < 500
          ? -1082
          : f < 528
            ? interpolate(f, [500, 528], [-1082, 0], { ...clamp, easing: easeIO })
            : 0;
  const camY =
    f < 390
      ? 0
      : f < 426
        ? interpolate(f, [390, 426], [0, -240], { ...clamp, easing: easeIO })
        : f < 500
          ? -240
          : f < 528
            ? interpolate(f, [500, 528], [-240, 0], { ...clamp, easing: easeIO })
            : 0;

  const capO = (a: number, b: number, c: number, d: number) =>
    Math.min(interpolate(f, [a, b], [0, 1], clamp), interpolate(f, [c, d], [1, 0], clamp));

  return (
    <AbsoluteFill style={{ background: STAGE, fontFamily: SANS }}>
      {/* 镜头：收球段 punch-in（origin 0 0，平移换算按左上原点） */}
      <AbsoluteFill
        style={{
          transform: `scale(${camZ}) translate(${camX}px, ${camY}px)`,
          transformOrigin: "0 0",
        }}
      >
        {/* 舞台柔光：给玻璃一层可模糊的环境 */}
        <div
          style={{
            position: "absolute",
            left: -140,
            top: 60,
            width: 1500,
            height: 980,
            borderRadius: "50%",
            background: "radial-gradient(closest-side, rgba(61,139,212,0.13), transparent)",
            filter: "blur(10px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: -220,
            top: -260,
            width: 1100,
            height: 900,
            borderRadius: "50%",
            background: "radial-gradient(closest-side, rgba(255,255,255,0.9), transparent)",
          }}
        />

        {/* 小窗落影（贴在可视底缘正下方，随缩放跟随） */}
        {finalOpacity > 0.01 && (
          <div
            style={{
              position: "absolute",
              left: wOx + (150 - 340) * (wScale / WS),
              top: wOy + 520 * wScale + 6,
              width: 680 * (wScale / WS),
              height: 44,
              borderRadius: "50%",
              background: `radial-gradient(ellipse, rgba(40,70,110,${0.2 * finalOpacity}), transparent 68%)`,
              filter: "blur(8px)",
            }}
          />
        )}

        {/* 小窗本体 */}
        {finalOpacity > 0.005 && (
          <Widget
            t={f}
            fps={fps}
            ox={wOx}
            oy={wOy}
            scale={wScale}
            opacity={finalOpacity}
            showStats={showStats}
          />
        )}

        {/* 悬浮球 */}
        {ballOpacity > 0.005 && (
          <div style={{ transform: `scale(${ballScale})`, transformOrigin: `${ballX}px ${ballY}px` }}>
            <BallDisc x={ballX} y={ballY} size={104} pct={40} count="3" opacity={ballOpacity} />
          </div>
        )}

        {/* 文案（开场纯产品，无浮字；品牌在尾板） */}

        <Caption x={1010} y={360} lines={["想到，就记下。"]} sub="不限时 · 每日 · 限时，回车即加" o={capO(74, 92, 214, 232)} />
        <Caption x={1010} y={360} lines={["完成，点一下就好。"]} sub="已完成的自动沉底，不打扰" o={capO(228, 246, 298, 314)} />
        <Caption
          x={1010}
          y={360}
          lines={["每日任务，睡一觉自己回来。"]}
          sub="每天 00:00 自动重来，习惯不断档"
          o={capO(314, 332, 350, 366)}
          size={50}
        />
        <Caption
          x={1265}
          y={484}
          lines={["收进一颗球，", "贴边，不挡屏幕。"]}
          o={capO(440, 458, 488, 504)}
          size={62}
        />
        <Caption x={1010} y={360} lines={["坚持，看得见。"]} sub="完成率 · 连续打卡 · 按期率" o={capO(556, 574, 600, 618)} />

        {/* 光标 */}
        <Cursor f={f} />
      </AbsoluteFill>

      {/* 尾板（待小窗淡出后再入场，避免重叠） */}
      {(() => {
        const o1 = interpolate(f, [660, 678], [0, 1], { ...clamp, easing: easeOut });
        const o2 = interpolate(f, [676, 692], [0, 1], { ...clamp, easing: easeOut });
        const o3 = interpolate(f, [686, 702], [0, 1], { ...clamp, easing: easeOut });
        const pop = Math.max(guardedSpring(f, 660, fps, 14, 90), 0.001);
        if (f < 658) return null;
        return (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 96,
                fontWeight: 600,
                color: A_INK,
                letterSpacing: -1,
                opacity: o1,
                transform: `scale(${pop})`,
              }}
            >
              MyToDo<span style={{ color: ACCENT }}>.</span>
            </div>
            <div style={{ fontSize: 26, color: A_DIM, marginTop: 20, opacity: o2 }}>
              再好的 to-do，不如一个用得下去的。
            </div>
            <div style={{ fontSize: 20, color: A_DIM, marginTop: 52, opacity: o3, letterSpacing: 1 }}>
              github.com/jovanzhang6/MyToDo
            </div>
            <div style={{ fontSize: 15, color: A_DIM, opacity: o3, letterSpacing: 4, marginTop: 14 }}>
              MIT · WINDOWS
            </div>
          </AbsoluteFill>
        );
      })()}
    </AbsoluteFill>
  );
};
