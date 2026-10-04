import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/* ============================================================
   MyToDo 宣传片 v4 —— 「一块屏幕」
   视觉主角：一块悬浮的屏幕（圆角 + 投影 + 屏幕高光），
   全部产品画面都发生在屏幕里；悬浮球从屏幕中飞出落到背景上。
   版式：明亮画廊 / 编辑排版，serif 大字 + 角标字幕系统。
   ============================================================ */

const IVORY = "#F4F1E8";
const IVORY2 = "#E9E4D4";
const INK = "#1C1B18";
const DIM = "#8A8474";
const GREEN = "#177A53";
const GREEN_D = "#0E5C3F";
const GREEN_L = "#E3F0E8";
const AMBER = "#A9720F";
const AMBER_L = "#F7ECDA";
const GRAY_L = "#ECE8DC";
const SCREEN = "#FCFBF7";

const SERIF = `Georgia, "Times New Roman", "Microsoft YaHei", serif`;
const SANS = `"Segoe UI", "Microsoft YaHei", system-ui, sans-serif`;
const MONO = `Consolas, "Courier New", monospace`;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeOut = Easing.out(Easing.cubic);
const easeInOut = Easing.inOut(Easing.cubic);

/* ---------- 通用 ---------- */

const Ball: React.FC<{ d: number; badge?: string; badgeScale?: number }> = ({
  d,
  badge,
  badgeScale = 1,
}) => (
  <div
    style={{
      position: "relative",
      width: d,
      height: d,
      borderRadius: "50%",
      background: `radial-gradient(circle at 32% 26%, #35A87B, ${GREEN} 55%, ${GREEN_D})`,
      boxShadow: `0 ${d * 0.16}px ${d * 0.42}px rgba(14,92,63,0.38), inset 0 -${
        d * 0.07
      }px ${d * 0.14}px rgba(0,0,0,0.20)`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <svg width={d * 0.52} height={d * 0.52} viewBox="0 0 100 100">
      <path
        d="M28 53 L44 68 L73 34"
        stroke="#fff"
        strokeWidth={10}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
    {badge !== undefined && (
      <div
        style={{
          position: "absolute",
          right: -d * 0.08,
          top: -d * 0.08,
          background: "#fff",
          color: GREEN_D,
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: d * 0.19,
          lineHeight: 1,
          padding: d * 0.05,
          borderRadius: 999,
          border: `2px solid ${GREEN_L}`,
          boxShadow: "0 6px 16px rgba(28,27,24,0.18)",
          transform: `scale(${badgeScale})`,
        }}
      >
        {badge}
      </div>
    )}
  </div>
);

/* 悬浮的屏幕：无硬件、无支架，纯一块面 */
const Screen: React.FC<{
  x?: number;
  y?: number;
  s?: number;
  swing?: number;
  children: React.ReactNode;
}> = ({ x = 0, y = 0, s = 1, swing = 0, children }) => (
  <div
    style={{
      position: "absolute",
      left: 385,
      top: 158,
      width: 1150,
      height: 700,
      transform: `translate(${x}px, ${y}px) scale(${s})`,
      transformOrigin: "center center",
    }}
  >
    {/* 环境辉光 */}
    <div
      style={{
        position: "absolute",
        inset: -90,
        borderRadius: 70,
        background:
          "radial-gradient(closest-side, rgba(23,122,83,0.13), transparent)",
        filter: "blur(28px)",
      }}
    />
    {/* 屏幕本体 */}
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 24,
        overflow: "hidden",
        background: SCREEN,
        border: "1px solid rgba(28,27,24,0.10)",
        boxShadow:
          "0 90px 170px rgba(28,27,24,0.26), 0 30px 60px rgba(28,27,24,0.16), inset 0 1px 0 rgba(255,255,255,0.7)",
        transform: `perspective(1600px) rotateY(${swing}deg)`,
        transformOrigin: "right center",
      }}
    >
      {children}
      {/* 屏幕高光 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "linear-gradient(112deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.04) 26%, transparent 42%)",
        }}
      />
    </div>
  </div>
);

/* 任务类型小徽章 */
const KIND_STYLE: Record<string, { label: string; c: string; bg: string }> = {
  daily: { label: "每日", c: GREEN_D, bg: GREEN_L },
  due: { label: "限时", c: AMBER, bg: AMBER_L },
  any: { label: "不限时", c: "#5D594E", bg: GRAY_L },
};

const Chip: React.FC<{ kind: string }> = ({ kind }) => {
  const k = KIND_STYLE[kind];
  return (
    <span
      style={{
        fontFamily: SANS,
        fontSize: 16,
        fontWeight: 600,
        color: k.c,
        background: k.bg,
        borderRadius: 999,
        padding: "5px 14px",
        letterSpacing: 1,
        whiteSpace: "nowrap",
      }}
    >
      {k.label}
    </span>
  );
};

/* 屏幕底部输入条 */
const InputBar: React.FC<{ t: number; at?: number }> = ({ t, at = 30 }) => (
  <div
    style={{
      position: "absolute",
      left: 64,
      right: 64,
      bottom: 38,
      display: "flex",
      alignItems: "center",
      gap: 14,
      border: "1.5px solid rgba(28,27,24,0.13)",
      borderRadius: 999,
      padding: "13px 22px",
      background: "#fff",
      boxShadow: "0 8px 20px rgba(28,27,24,0.05)",
      opacity: interpolate(t, [at, at + 14], [0, 1], clamp),
    }}
  >
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        border: "2px solid #C9C3B4",
      }}
    />
    <span style={{ fontSize: 19, color: "#B7B1A0" }}>记一件要做的事…</span>
    <span
      style={{
        marginLeft: "auto",
        fontFamily: MONO,
        fontSize: 13,
        color: "#B7B1A0",
        border: "1px solid rgba(28,27,24,0.16)",
        borderRadius: 6,
        padding: "2px 8px",
      }}
    >
      Enter
    </span>
  </div>
);

/* 屏幕内 UI 一：今日清单 */
const TodayList: React.FC<{ t: number; collapse?: number }> = ({
  t,
  collapse = 0,
}) => {
  const { fps } = useVideoConfig();
  const doneAt = [70, -1, -1, 92, -1];
  const doneCount = (t > 70 ? 1 : 0) + (t > 92 ? 1 : 0);
  const rows = [
    { kind: "daily", text: "晨间拉伸 15 分钟", sub: "" },
    { kind: "daily", text: "回复客户邮件", sub: "" },
    { kind: "due", text: "交季度报告", sub: "明天到期" },
    { kind: "any", text: "整理灵感清单", sub: "" },
    { kind: "daily", text: "夜间复盘 10 分钟", sub: "" },
  ];
  const toastIn = interpolate(t, [116, 130], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const toastOut = interpolate(t, [168, 180], [1, 0], clamp);
  const toast = Math.min(toastIn, toastOut);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: "52px 64px",
        fontFamily: SANS,
        transform: `translate(${collapse * 300}px, ${collapse * 60}px) scale(${
          1 - collapse * 0.45
        })`,
        transformOrigin: "70% 45%",
        opacity: 1 - collapse * 0.85,
      }}
    >
      {/* 头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 26,
          opacity: interpolate(t, [4, 14], [0, 1], clamp),
        }}
      >
        <div>
          <div style={{ fontFamily: SERIF, fontSize: 46, color: INK }}>
            Today
          </div>
          <div style={{ fontSize: 19, color: DIM, marginTop: 4 }}>
            10 月 4 日 · 周日
          </div>
        </div>
        <div
          style={{
            background: GREEN_L,
            color: GREEN_D,
            fontFamily: MONO,
            fontSize: 20,
            fontWeight: 700,
            borderRadius: 999,
            padding: "8px 20px",
          }}
        >
          {doneCount} / 5
        </div>
      </div>
      {/* 任务行 */}
      {rows.map((r, i) => {
        const rowIn = interpolate(t, [8 + i * 5, 22 + i * 5], [0, 1], {
          ...clamp,
          easing: easeOut,
        });
        const done = doneAt[i] >= 0 && t > doneAt[i];
        const pop = spring({
          frame: t - doneAt[i],
          fps,
          config: { damping: 12, stiffness: 220 },
        });
        const strike = interpolate(t, [doneAt[i] + 4, doneAt[i] + 16], [0, 1], {
          ...clamp,
          easing: easeOut,
        });
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 22,
              padding: "21px 6px",
              borderTop: "1px solid rgba(28,27,24,0.09)",
              opacity: rowIn,
              transform: `translateX(${(1 - rowIn) * 26}px)`,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                flexShrink: 0,
                border: done ? `2px solid ${GREEN}` : "2px solid #C9C3B4",
                background: done ? GREEN : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transform: `scale(${done ? Math.max(pop, 0.001) : 1})`,
              }}
            >
              {done && (
                <svg width={20} height={20} viewBox="0 0 100 100">
                  <path
                    d="M28 53 L44 68 L73 34"
                    stroke="#fff"
                    strokeWidth={11}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <div style={{ position: "relative", flex: 1 }}>
              <div style={{ fontSize: 25, color: INK, fontWeight: 500 }}>
                {r.text}
                {r.sub && (
                  <span style={{ fontSize: 19, color: AMBER, marginLeft: 12 }}>
                    {r.sub}
                  </span>
                )}
              </div>
              {done && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "55%",
                    height: 2.5,
                    width: `${strike * 100}%`,
                    background: "rgba(28,27,24,0.55)",
                    borderRadius: 2,
                  }}
                />
              )}
            </div>
            <Chip kind={r.kind} />
          </div>
        );
      })}
      <InputBar t={t} at={34} />
      {/* 到期 toast */}
      {toast > 0.01 && (
        <div
          style={{
            position: "absolute",
            top: 30,
            right: 36,
            display: "flex",
            alignItems: "center",
            gap: 16,
            background: "#fff",
            borderRadius: 14,
            padding: "16px 24px 16px 18px",
            boxShadow: "0 18px 44px rgba(28,27,24,0.22)",
            borderLeft: `5px solid ${GREEN}`,
            opacity: toast,
            transform: `translateY(${(1 - toast) * -90}px)`,
          }}
        >
          <Ball d={34} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>
              到期提醒
            </div>
            <div style={{ fontSize: 15, color: DIM, marginTop: 2 }}>
              交季度报告 · 今天到期
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* 屏幕内 UI 二：三种生命周期 */
const Lifecycle: React.FC<{ t: number }> = ({ t }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      padding: "60px 72px",
      fontFamily: SANS,
    }}
  >
    <div style={{ marginBottom: 30 }}>
      <div style={{ fontFamily: SERIF, fontSize: 44, color: INK }}>
        三种生命周期
      </div>
      <div style={{ fontSize: 19, color: DIM, marginTop: 6 }}>
        每日重来 · 限时归档 · 随手记 —— 还能互相转化
      </div>
    </div>
    {[
      { kind: "daily", note: "每天 00:00 自动重来" },
      { kind: "due", note: "过期自动归档" },
      { kind: "any", note: "想到就记，没有压力" },
    ].map((r, i) => {
      const rowIn = interpolate(t, [10 + i * 9, 26 + i * 9], [0, 1], {
        ...clamp,
        easing: easeOut,
      });
      /* 第一行演示「每日 → 限时」转化 */
      const morphA = interpolate(t, [96, 106], [1, 0], clamp);
      const morphB = interpolate(t, [106, 116], [0, 1], clamp);
      const isMorphRow = i === 0;
      const textB = "加练一组卷腹 · 10 月 6 日前";
      return (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            padding: "28px 10px",
            borderTop: "1px solid rgba(28,27,24,0.09)",
            opacity: rowIn,
            transform: `translateX(${(1 - rowIn) * 30}px)`,
          }}
        >
          <div style={{ position: "relative", width: 108, height: 34 }}>
            {isMorphRow ? (
              <>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    opacity: morphA,
                    transform: `scaleX(${Math.max(morphA, 0.001)})`,
                  }}
                >
                  <Chip kind="daily" />
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    opacity: morphB,
                    transform: `scaleX(${Math.max(morphB, 0.001)})`,
                  }}
                >
                  <Chip kind="due" />
                </div>
              </>
            ) : (
              <Chip kind={r.kind} />
            )}
          </div>
          <div style={{ flex: 1, position: "relative" }}>
            {isMorphRow ? (
              <>
                <div
                  style={{
                    fontSize: 28,
                    color: INK,
                    fontWeight: 500,
                    opacity: morphA,
                  }}
                >
                  晨间拉伸 15 分钟
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    fontSize: 28,
                    color: INK,
                    fontWeight: 500,
                    opacity: morphB,
                  }}
                >
                  {textB}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 28, color: INK, fontWeight: 500 }}>
                {i === 1 ? "交季度报告 · 10 月 5 日" : "整理灵感清单"}
              </div>
            )}
          </div>
          <div
            style={{
              fontSize: 19,
              color: isMorphRow && morphB > 0.5 ? AMBER : DIM,
              whiteSpace: "nowrap",
            }}
          >
            {isMorphRow ? (morphB > 0.5 ? "截止 10 月 6 日" : r.note) : r.note}
          </div>
        </div>
      );
    })}
    <InputBar t={t} at={40} />
  </div>
);

/* 屏幕内 UI 三：统计 */
const StatsDash: React.FC<{ t: number }> = ({ t }) => {
  const pct = Math.round(interpolate(t, [18, 52], [0, 92], clamp));
  const streak = Math.round(interpolate(t, [26, 60], [0, 21], clamp));
  const onTime = Math.round(interpolate(t, [34, 68], [0, 98], clamp));
  const bars = [0.45, 0.7, 0.55, 0.85, 0.65, 0.95, 0.4];
  const heat = [0.16, 0.4, 0.62, 0.85, 0.5, 0.74, 0.28, 0.92, 0.55, 0.68];
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: "48px 64px",
        fontFamily: SANS,
      }}
    >
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: SERIF, fontSize: 44, color: INK }}>
          这一个月
        </div>
        <div style={{ fontSize: 19, color: DIM, marginTop: 4 }}>
          坚持，看得见
        </div>
      </div>
      {/* 三个数字 */}
      <div style={{ display: "flex", gap: 22, marginBottom: 24 }}>
        {[
          { v: pct, u: "%", label: "完成率", c: GREEN_D },
          { v: streak, u: " 天", label: "连续打卡", c: INK },
          { v: onTime, u: "%", label: "按期完成", c: INK },
        ].map((s, i) => {
          const tin = interpolate(t, [12 + i * 6, 24 + i * 6], [0, 1], clamp);
          return (
            <div
              key={i}
              style={{
                flex: 1,
                background: "#fff",
                borderRadius: 16,
                padding: "18px 26px",
                border: "1px solid rgba(28,27,24,0.08)",
                boxShadow: "0 10px 26px rgba(28,27,24,0.07)",
                opacity: tin,
                transform: `translateY(${(1 - tin) * 18}px)`,
              }}
            >
              <div style={{ fontSize: 16, color: DIM, marginBottom: 6 }}>
                {s.label}
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 52, color: s.c }}>
                {s.v}
                <span style={{ fontSize: 24 }}>{s.u}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 36 }}>
        {/* 热力图 */}
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: "18px 24px",
            border: "1px solid rgba(28,27,24,0.08)",
            boxShadow: "0 10px 26px rgba(28,27,24,0.07)",
          }}
        >
          <div style={{ fontSize: 16, color: DIM, marginBottom: 12 }}>
            近 30 天
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(10, 30px)",
              gap: 8,
            }}
          >
            {Array.from({ length: 30 }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 7,
                  background: `rgba(23,122,83,${heat[(i * 7 + 3) % 10]})`,
                  opacity: interpolate(t, [36 + i * 1.1, 44 + i * 1.1], [0, 1], clamp),
                  transform: `scale(${interpolate(t, [36 + i * 1.1, 46 + i * 1.1], [0.4, 1], { ...clamp, easing: easeOut })})`,
                }}
              />
            ))}
          </div>
        </div>
        {/* 周柱状 */}
        <div
          style={{
            flex: 1,
            background: "#fff",
            borderRadius: 16,
            padding: "18px 24px",
            border: "1px solid rgba(28,27,24,0.08)",
            boxShadow: "0 10px 26px rgba(28,27,24,0.07)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ fontSize: 16, color: DIM, marginBottom: 12 }}>
            本周完成
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "flex-end",
              gap: 18,
              borderBottom: "1px solid rgba(28,27,24,0.12)",
              paddingBottom: 2,
            }}
          >
            {bars.map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: h * 130,
                  borderRadius: "8px 8px 3px 3px",
                  background: i === 5 ? GREEN : "#BFD8CB",
                  transformOrigin: "bottom",
                  transform: `scaleY(${interpolate(t, [40 + i * 4, 54 + i * 4], [0, 1], { ...clamp, easing: easeOut })})`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 13,
          color: DIM,
          fontStyle: "italic",
          opacity: interpolate(t, [70, 80], [0, 1], clamp),
        }}
      >
        数据为演示样例
      </div>
    </div>
  );
};

/* 背景上的悬浮球（屏幕外） */
const DeskBall: React.FC<{ t: number }> = ({ t }) => {
  const { fps } = useVideoConfig();
  /* 飞出路径：屏幕内 (1240, 470) → 屏幕外 (1620, 400) */
  const fly = interpolate(t, [38, 66], [0, 1], { ...clamp, easing: easeInOut });
  const scale = interpolate(fly, [0, 1], [0.62, 1.18], clamp);
  const bx = interpolate(fly, [0, 1], [1240, 1620], clamp);
  const by =
    interpolate(fly, [0, 1], [470, 400], clamp) +
    (fly >= 1 ? Math.sin(t / 6) * 7 : 0);
  const pop = spring({
    frame: t - 16,
    fps,
    config: { damping: 12, stiffness: 160 },
  });
  const appear = t >= 16 ? Math.max(pop, 0.001) : 0;
  const shadow = interpolate(t, [58, 72], [0, 0.9], clamp);
  const badge = t < 84 ? "3" : "2";
  const badgePop = spring({
    frame: t - 84,
    fps,
    config: { damping: 10, stiffness: 200 },
  });
  /* 拖尾残影 */
  const ghosts = [0.82, 0.64].map((g, gi) => {
    const gf = interpolate(
      t,
      [38, 66],
      [0, Math.max(fly - 0.12 * (gi + 1), 0)],
      clamp
    );
    if (gf <= 0 || gf >= 1) return null;
    return (
      <div
        key={gi}
        style={{
          position: "absolute",
          left: interpolate(gf, [0, 1], [1240, 1620], clamp) - 40 * g,
          top: interpolate(gf, [0, 1], [470, 400], clamp) - 40 * g,
          width: 80 * g,
          height: 80 * g,
          borderRadius: "50%",
          background: GREEN,
          opacity: 0.18 * g,
        }}
      />
    );
  });
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {ghosts}
      {/* 落在背景上的影子 */}
      <div
        style={{
          position: "absolute",
          left: bx - 90,
          top: 566,
          width: 180,
          height: 34,
          borderRadius: "50%",
          background: `rgba(28,27,24,${0.28 * shadow})`,
          filter: "blur(6px)",
        }}
      />
      {appear > 0 && (
        <div
          style={{
            position: "absolute",
            left: bx - 73 * scale,
            top: by - 73 * scale,
            opacity: appear,
            transform: `scale(${scale})`,
          }}
        >
          <Ball d={146} badge={badge} badgeScale={Math.max(badgePop, 0.001)} />
        </div>
      )}
      {/* 说明标签 */}
      {(() => {
        const lab = interpolate(t, [70, 82], [0, 1], {
          ...clamp,
          easing: easeOut,
        });
        if (lab <= 0.01) return null;
        return (
          <div
            style={{
              position: "absolute",
              left: 1230,
              top: 296,
              opacity: lab,
              transform: `translateY(${(1 - lab) * 14}px)`,
              fontFamily: SANS,
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 700, color: INK }}>
              收进一颗球
            </div>
            <div style={{ fontSize: 19, color: DIM, marginTop: 6 }}>
              贴边隐藏 · 点击展开 · 不挡屏幕
            </div>
          </div>
        );
      })()}
    </div>
  );
};

/* 编辑排版角标系统（全程固定） */
const Chrome: React.FC<{ f: number }> = ({ f }) => {
  const chapters = ["开场", "任务", "生命周期", "悬浮球", "统计", "开始使用"];
  const ch =
    f < 100 ? 0 : f < 256 ? 1 : f < 410 ? 2 : f < 564 ? 3 : f < 656 ? 4 : 5;
  const sec = Math.floor(f / 30) + 1;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        fontFamily: SANS,
        pointerEvents: "none",
      }}
    >
      {/* 背景巨型描边字 */}
      <div
        style={{
          position: "absolute",
          top: -36,
          left: 90 + Math.sin(f / 210) * 26,
          fontFamily: SERIF,
          fontSize: 296,
          fontWeight: 700,
          letterSpacing: -6,
          color: "transparent",
          WebkitTextStroke: "1.5px rgba(28,27,24,0.07)",
          userSelect: "none",
        }}
      >
        MyToDo
      </div>
      {/* 柔色光斑 */}
      <div
        style={{
          position: "absolute",
          left: -260 + Math.sin(f / 160) * 40,
          bottom: -320,
          width: 860,
          height: 860,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(23,122,83,0.12), transparent 62%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -300 + Math.cos(f / 190) * 36,
          top: -300,
          width: 780,
          height: 780,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(169,114,15,0.10), transparent 62%)",
        }}
      />
      {/* 四角角标 */}
      <div
        style={{
          position: "absolute",
          left: 64,
          top: 48,
          fontSize: 15,
          letterSpacing: 5,
          color: DIM,
        }}
      >
        MYTODO — PRODUCT FILM
      </div>
      <div
        style={{
          position: "absolute",
          right: 64,
          top: 48,
          fontSize: 15,
          letterSpacing: 5,
          color: DIM,
        }}
      >
        2026 · WINDOWS
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          bottom: 44,
          fontSize: 15,
          letterSpacing: 3,
          color: DIM,
        }}
      >
        <span style={{ fontFamily: MONO, color: INK }}>0{ch + 1}</span>
        {" / 06 — "}
        {chapters[ch]}
      </div>
      <div
        style={{
          position: "absolute",
          right: 64,
          bottom: 44,
          fontSize: 15,
          letterSpacing: 3,
          color: DIM,
          fontFamily: MONO,
        }}
      >
        {String(sec).padStart(2, "0")} / 24 S
      </div>
    </div>
  );
};

/* 场景容器：聚焦式出入场（rack focus） */
const Scene: React.FC<{
  f: number;
  a: number;
  b: number;
  c: number;
  d: number;
  children: React.ReactNode;
}> = ({ f, a, b, c, d, children }) => {
  if (f < a - 1 || f > d) return null;
  const o = Math.min(
    interpolate(f, [a, b], [0, 1], clamp),
    interpolate(f, [c, d], [1, 0], clamp)
  );
  const bl = Math.max(
    interpolate(f, [a, b], [15, 0], clamp),
    interpolate(f, [c, d], [0, 15], clamp)
  );
  return (
    <AbsoluteFill
      style={{
        opacity: o,
        filter: bl > 0.05 ? `blur(${bl}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/* 场景内镜头（缩放/平移） */
const Lens: React.FC<{
  z: number;
  x?: number;
  y?: number;
  children: React.ReactNode;
}> = ({ z, x = 0, y = 0, children }) => (
  <AbsoluteFill
    style={{ transform: `scale(${z}) translate(${x}px, ${y}px)` }}
  >
    {children}
  </AbsoluteFill>
);

/* ============================================================ */

export const Promo: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(178deg, ${IVORY} 30%, ${IVORY2})`,
        fontFamily: SANS,
      }}
    >
      <Audio src={staticFile("music.wav")} />

      {/* 大景深安全底：防止镜头平移时露边 */}
      <div
        style={{
          position: "absolute",
          left: -700,
          top: -700,
          width: 3320,
          height: 2480,
          background: `linear-gradient(178deg, ${IVORY} 30%, ${IVORY2})`,
        }}
      />

      <Chrome f={f} />

      {/* ── S0 开场：编辑排版大字 ── */}
      <Scene f={f} a={2} b={16} c={96} d={112}>
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 21,
              letterSpacing: 10,
              color: DIM,
              marginBottom: 36,
              opacity: interpolate(f, [4, 16], [0, 1], clamp),
            }}
          >
            WINDOWS 桌面 · 待办事项
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 96,
              color: INK,
              letterSpacing: 2,
              opacity: interpolate(f, [10, 28], [0, 1], clamp),
              transform: `translateY(${
                (1 - interpolate(f, [10, 28], [0, 1], { ...clamp, easing: easeOut })) * 44
              }px)`,
            }}
          >
            再好的 to-do 软件，
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 96,
              letterSpacing: 2,
              marginTop: 10,
              color: INK,
              opacity: interpolate(f, [24, 42], [0, 1], clamp),
              transform: `translateY(${
                (1 - interpolate(f, [24, 42], [0, 1], { ...clamp, easing: easeOut })) * 44
              }px)`,
            }}
          >
            不如一个{" "}
            <span style={{ color: GREEN, fontStyle: "italic" }}>用得下去的</span>
            <span
              style={{
                display: "inline-block",
                width: 26,
                height: 26,
                marginLeft: 14,
                borderRadius: "50%",
                background: GREEN,
                transform: `scale(${spring({
                  frame: f - 38,
                  fps,
                  config: { damping: 11, stiffness: 170 },
                })})`,
                boxShadow: "0 8px 22px rgba(14,92,63,0.35)",
              }}
            />
          </div>
          {/* 三个特性小字 */}
          <div
            style={{
              display: "flex",
              gap: 44,
              marginTop: 54,
              fontSize: 19,
              color: DIM,
              letterSpacing: 4,
            }}
          >
            {["磨砂玻璃", "到期提醒", "坚持可见"].map((s, i) => (
              <div
                key={i}
                style={{
                  opacity: interpolate(f, [46 + i * 7, 58 + i * 7], [0, 1], clamp),
                  transform: `translateY(${
                    (1 - interpolate(f, [46 + i * 7, 58 + i * 7], [0, 1], { ...clamp, easing: easeOut })) * 20
                  }px)`,
                }}
              >
                {s}
              </div>
            ))}
          </div>
        </AbsoluteFill>
      </Scene>

      {/* ── S1 屏幕登场 · 今日清单 ── */}
      <Scene f={f} a={100} b={116} c={248} d={264}>
        {(() => {
          const t = f - 100;
          const rise = spring({
            frame: t,
            fps,
            config: { damping: 15, stiffness: 82 },
          });
          const z = interpolate(t, [0, 150], [1, 1.045], clamp);
          return (
            <Lens z={z}>
              <Screen
                x={150}
                y={(1 - rise) * 980}
                s={Math.max(0.965 + rise * 0.035, 0.001)}
                swing={(1 - rise) * -10}
              >
                <TodayList t={t} />
              </Screen>
              {/* 左侧字幕 */}
              {(() => {
                const cap = interpolate(t, [26, 42], [0, 1], {
                  ...clamp,
                  easing: easeOut,
                });
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: 118,
                      top: 400,
                      opacity: cap,
                      transform: `translateY(${(1 - cap) * 22}px)`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: SERIF,
                        fontSize: 104,
                        color: "transparent",
                        WebkitTextStroke: `1.6px ${GREEN}`,
                        lineHeight: 1,
                      }}
                    >
                      01
                    </div>
                    <div
                      style={{
                        width: 54,
                        height: 3,
                        background: GREEN,
                        margin: "22px 0",
                      }}
                    />
                    <div style={{ fontSize: 34, fontWeight: 700, color: INK }}>
                      打开就是今天
                    </div>
                    <div
                      style={{
                        fontSize: 19,
                        color: DIM,
                        marginTop: 10,
                        letterSpacing: 1,
                      }}
                    >
                      记下就别惦记 · 完成自动沉底
                    </div>
                  </div>
                );
              })()}
            </Lens>
          );
        })()}
      </Scene>

      {/* ── S2 三种生命周期 ── */}
      <Scene f={f} a={256} b={272} c={404} d={420}>
        {(() => {
          const t = f - 256;
          const dx = interpolate(t, [0, 150], [44, -44], clamp);
          return (
            <Lens z={1.02} x={dx}>
              <Screen x={150}>
                <Lifecycle t={t} />
              </Screen>
              {(() => {
                const cap = interpolate(t, [22, 38], [0, 1], {
                  ...clamp,
                  easing: easeOut,
                });
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: 118,
                      top: 400,
                      opacity: cap,
                      transform: `translateY(${(1 - cap) * 22}px)`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: SERIF,
                        fontSize: 104,
                        color: "transparent",
                        WebkitTextStroke: `1.6px ${GREEN}`,
                        lineHeight: 1,
                      }}
                    >
                      02
                    </div>
                    <div
                      style={{
                        width: 54,
                        height: 3,
                        background: GREEN,
                        margin: "22px 0",
                      }}
                    />
                    <div style={{ fontSize: 34, fontWeight: 700, color: INK }}>
                      三种生命周期
                    </div>
                    <div
                      style={{
                        fontSize: 19,
                        color: DIM,
                        marginTop: 10,
                        letterSpacing: 1,
                      }}
                    >
                      每日重来 · 限时归档 · 互相转化
                    </div>
                  </div>
                );
              })()}
            </Lens>
          );
        })()}
      </Scene>

      {/* ── S3 悬浮球：从屏幕里飞出来 ── */}
      <Scene f={f} a={410} b={426} c={558} d={574}>
        {(() => {
          const t = f - 410;
          const z = interpolate(t, [0, 50], [1, 1.06], clamp);
          const pz = interpolate(t, [50, 74], [1.06, 1.22], {
            ...clamp,
            easing: easeInOut,
          });
          const px = interpolate(t, [50, 74], [0, -813], {
            ...clamp,
            easing: easeInOut,
          });
          const py = interpolate(t, [50, 74], [0, -15], {
            ...clamp,
            easing: easeInOut,
          });
          const cap = interpolate(t, [10, 24], [0, 1], {
            ...clamp,
            easing: easeOut,
          });
          const capOut = interpolate(t, [46, 58], [1, 0], clamp);
          const capO = Math.min(cap, capOut);
          return (
            <Lens z={z * pz} x={px} y={py}>
              {/* 清单在屏幕内收缩，暗示收球 */}
              <Screen x={-140}>
                <TodayList
                  t={30}
                  collapse={interpolate(t, [0, 42], [0, 1], clamp)}
                />
              </Screen>
              <DeskBall t={t} />
              <div
                style={{
                  position: "absolute",
                  left: 118,
                  top: 400,
                  opacity: capO,
                }}
              >
                <div
                  style={{
                    fontFamily: SERIF,
                    fontSize: 104,
                    color: "transparent",
                    WebkitTextStroke: `1.6px ${GREEN}`,
                    lineHeight: 1,
                  }}
                >
                  03
                </div>
                <div
                  style={{
                    width: 54,
                    height: 3,
                    background: GREEN,
                    margin: "22px 0",
                  }}
                />
                <div style={{ fontSize: 34, fontWeight: 700, color: INK }}>
                  悬浮球
                </div>
              </div>
            </Lens>
          );
        })()}
      </Scene>

      {/* ── S4 统计 ── */}
      <Scene f={f} a={564} b={580} c={650} d={666}>
        {(() => {
          const t = f - 564;
          const z = interpolate(t, [0, 100], [1.1, 1.0], clamp);
          return (
            <Lens z={z}>
              <Screen x={150}>
                <StatsDash t={t} />
              </Screen>
              {(() => {
                const cap = interpolate(t, [20, 36], [0, 1], {
                  ...clamp,
                  easing: easeOut,
                });
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: 118,
                      top: 400,
                      opacity: cap,
                      transform: `translateY(${(1 - cap) * 22}px)`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: SERIF,
                        fontSize: 104,
                        color: "transparent",
                        WebkitTextStroke: `1.6px ${GREEN}`,
                        lineHeight: 1,
                      }}
                    >
                      04
                    </div>
                    <div
                      style={{
                        width: 54,
                        height: 3,
                        background: GREEN,
                        margin: "22px 0",
                      }}
                    />
                    <div style={{ fontSize: 34, fontWeight: 700, color: INK }}>
                      坚持，看得见
                    </div>
                    <div
                      style={{
                        fontSize: 19,
                        color: DIM,
                        marginTop: 10,
                        letterSpacing: 1,
                      }}
                    >
                      完成率 · 连续打卡 · 热力图
                    </div>
                  </div>
                );
              })()}
            </Lens>
          );
        })()}
      </Scene>

      {/* ── S5 尾板 ── */}
      <Scene f={f} a={656} b={672} c={718} d={730}>
        {(() => {
          const t = f - 656;
          const logoPop = spring({
            frame: t - 4,
            fps,
            config: { damping: 12, stiffness: 110 },
          });
          const l1 = interpolate(t, [12, 26], [0, 1], { ...clamp, easing: easeOut });
          const l2 = interpolate(t, [20, 34], [0, 1], { ...clamp, easing: easeOut });
          const l3 = interpolate(t, [28, 44], [0, 1], { ...clamp, easing: easeOut });
          return (
            <AbsoluteFill
              style={{
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  transform: `scale(${Math.max(logoPop, 0.001)})`,
                  marginBottom: 34,
                }}
              >
                <Ball d={104} />
              </div>
              <div
                style={{
                  fontFamily: SERIF,
                  fontSize: 88,
                  color: INK,
                  letterSpacing: 1,
                  opacity: l1,
                  transform: `translateY(${(1 - l1) * 26}px)`,
                }}
              >
                MyToDo
              </div>
              <div
                style={{
                  fontFamily: SERIF,
                  fontStyle: "italic",
                  fontSize: 27,
                  color: DIM,
                  marginTop: 16,
                  opacity: l2,
                  transform: `translateY(${(1 - l2) * 20}px)`,
                }}
              >
                再好的 to-do 软件，不如一个用得下去的。
              </div>
              <div
                style={{
                  marginTop: 44,
                  fontFamily: MONO,
                  fontSize: 21,
                  letterSpacing: 2,
                  color: GREEN_D,
                  border: `1.5px solid ${GREEN}`,
                  borderRadius: 999,
                  padding: "13px 34px",
                  opacity: l3,
                  transform: `translateY(${(1 - l3) * 20}px)`,
                  background: "rgba(255,255,255,0.55)",
                }}
              >
                github.com/jovanzhang6/MyToDo
              </div>
              <div
                style={{
                  marginTop: 22,
                  fontSize: 15,
                  letterSpacing: 4,
                  color: DIM,
                  opacity: l3,
                }}
              >
                MIT · WINDOWS / MACOS(计划)
              </div>
            </AbsoluteFill>
          );
        })()}
      </Scene>
    </AbsoluteFill>
  );
};
