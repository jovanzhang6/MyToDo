// 可复用 UI 模型组件（与应用 1:1 视觉）
import React from "react";
import { C, FONT } from "./theme";

export const Win: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({
  style, children,
}) => (
  <div style={{
    width: 300, height: 520, background: C.glass, borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.65)",
    boxShadow: "0 30px 70px rgba(50,90,150,0.30)",
    display: "flex", flexDirection: "column", overflow: "hidden",
    fontFamily: FONT, color: C.ink, backdropFilter: "blur(6px)", ...style,
  }}>{children}</div>
);

export const Titlebar: React.FC<{ date?: string }> = ({ date = "9月25日 周五" }) => (
  <div style={{ height: 38, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px", flex: "none" }}>
    <span style={{ fontSize: 12.5, fontWeight: 600, color: C.inkDim }}>{date}</span>
    <span style={{ display: "flex", gap: 5 }}>
      {["◎", "⣿", "⚙", "◎", "×"].map((g, i) => (
        <i key={i} style={{ width: 16, height: 16, borderRadius: 4, background: "rgba(120,150,180,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontStyle: "normal", fontSize: 8, opacity: 0.8 }}>{g}</i>
      ))}
    </span>
  </div>
);

export const Row: React.FC<{ text: string; kind: "daily" | "limited" | "open"; done?: boolean; badge: string }> = ({
  text, kind, done, badge,
}) => {
  const badgeStyle: React.CSSProperties =
    kind === "limited"
      ? { background: "rgba(212,72,61,0.14)", color: C.danger, fontWeight: 600 }
      : kind === "daily"
      ? { background: "rgba(61,139,212,0.15)", color: C.accent }
      : { background: "rgba(120,150,180,0.16)", color: C.inkDim };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "8px 8px", marginTop: 5,
      borderRadius: 8, background: done ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.5)",
      border: `1px solid ${done ? "rgba(130,160,190,0.10)" : "rgba(130,160,190,0.18)"}`,
    }}>
      <span style={{
        width: 14, height: 14, borderRadius: 4, flex: "none",
        border: `1.6px solid ${C.accent}`,
        background: done ? C.accent : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: 10, lineHeight: 1,
      }}>{done ? "✓" : ""}</span>
      <span style={{
        flex: 1, fontSize: 12.5, color: done ? "#46586c" : C.ink,
        textDecoration: done ? "line-through" : "none",
        textDecorationThickness: done ? 2 : undefined,
        textDecorationColor: done ? "#223247" : undefined,
      }}>{text}</span>
      <span style={{ flex: "none", fontSize: 10.5, padding: "2px 7px", borderRadius: 5, ...badgeStyle }}>{badge}</span>
    </div>
  );
};

export const Pills: React.FC<{ active?: "open" | "daily" | "limited" }> = ({ active = "open" }) => (
  <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
    {([["open", "不限时"], ["daily", "每日"], ["limited", "限时"]] as const).map(([v, t]) => (
      <span key={v} style={{
        fontSize: 11, padding: "3px 10px", borderRadius: 999,
        background: v === active ? C.accent : "rgba(255,255,255,0.45)",
        border: `1px solid ${v === active ? C.accent : "rgba(120,150,180,0.28)"}`,
        color: v === active ? "#fff" : C.inkDim,
      }}>{t}</span>
    ))}
  </div>
);

export const Ball: React.FC<{ size?: number; style?: React.CSSProperties; count?: string; done?: boolean }> = ({
  size = 84, style, count = "1", done,
}) => (
  <div style={{
    width: size, height: size, borderRadius: "50%",
    background: done ? "#58a942" : "linear-gradient(160deg,#6aa7dd,#3d7fc0)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 14px 30px rgba(30,60,100,0.35)", position: "relative", ...style,
  }}>
    <div style={{
      position: "absolute", inset: 5, borderRadius: "50%",
      background: done ? "#58a942" : "rgba(255,255,255,0.92)",
    }} />
    <div style={{
      position: "relative", width: "72%", height: "72%", borderRadius: "50%",
      background: done ? "rgba(18,60,26,0.9)" : "rgba(21,48,78,0.9)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    }}>
      <b style={{ fontSize: size * 0.28, color: done ? "#7ed87e" : "#fff", lineHeight: 1.1 }}>{count}</b>
      <small style={{ fontSize: size * 0.16, color: done ? "rgba(126,216,126,0.8)" : "rgba(255,255,255,0.75)" }}>待办</small>
    </div>
  </div>
);
