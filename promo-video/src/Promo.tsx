// 宣传片主合成 v3：24s @30fps，六场，明亮演播室风格，高信息密度
// 分镜：S0 品牌开场(0-90) / S1 主窗+到期提醒(90-240) / S2 三类任务(240-390)
//       S3 悬浮球贴边(390-510) / S4 统计(510-630) / S5 尾板(630-720)
import React from "react";
import {
  AbsoluteFill, Audio, Easing, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig,
} from "remotion";
import { C, FONT } from "./theme";
import { Ball, Pills, Row, Titlebar, Win } from "./ui";

const BG_GRADIENT =
  "radial-gradient(1200px 800px at 15% 10%, #ffffff 0%, transparent 55%)," +
  "radial-gradient(1000px 700px at 85% 85%, #d8ecdc 0%, transparent 60%)," +
  "linear-gradient(135deg,#f2f8f2 0%,#e8f2fa 50%,#e2eef8 100%)";

const easeOut = Easing.out(Easing.cubic);
const easeInOut = Easing.inOut(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 演播室底子：亮渐变 + 光斑 + 细颗粒点阵 */
const Studio: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill>
    <AbsoluteFill style={{ background: BG_GRADIENT }} />
    <div style={{
      position: "absolute", width: 1000, height: 700, borderRadius: "50%",
      left: -280, top: -300,
      background: "radial-gradient(circle,rgba(255,255,255,0.9),transparent 65%)",
    }} />
    <div style={{
      position: "absolute", width: 900, height: 650, borderRadius: "50%",
      right: -260, bottom: -240,
      background: "radial-gradient(circle,rgba(180,220,240,0.55),transparent 65%)",
    }} />
    {children}
  </AbsoluteFill>
);

/** 背景缓漂粒子（确定性） */
const Particles: React.FC<{ f: number }> = ({ f }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {Array.from({ length: 14 }).map((_, i) => {
      const bx = (i * 137 + 60) % 1920;
      const by = (i * 251 + 40) % 1080;
      const r = 5 + (i % 4) * 4;
      const dx = Math.sin((f + i * 30) / 40) * 26;
      const dy = Math.cos((f + i * 22) / 36) * 20;
      return (
        <div key={i} style={{
          position: "absolute", left: bx + dx, top: by + dy,
          width: r * 2, height: r * 2, borderRadius: "50%",
          background: i % 3 === 0 ? "rgba(61,139,212,0.16)" : "rgba(255,255,255,0.65)",
          filter: "blur(1px)",
        }} />
      );
    })}
  </AbsoluteFill>
);

/** 场景大标题（顶部居中） */
const SceneTitle: React.FC<{ frame: number; main: string; sub?: string }> = ({ frame, main, sub }) => {
  const on = interpolate(frame, [4, 18], [0, 1], { ...clamp, easing: easeOut });
  const off = interpolate(frame, [116, 128], [1, 0], clamp);
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, top: 56, textAlign: "center",
      opacity: Math.min(on, off),
    }}>
      <div style={{ fontSize: 34, fontWeight: 700, color: C.ink }}>{main}</div>
      {sub && <div style={{ fontSize: 15.5, color: C.inkDim, marginTop: 10 }}>{sub}</div>}
    </div>
  );
};

/** 电影感镜头：scale 推拉 + 平移 + 焦点虚化 */
const Cam: React.FC<{
  zoom: number; cx: number; cy: number; blur?: number; children: React.ReactNode;
}> = ({ zoom, cx, cy, blur = 0, children }) => (
  <div style={{
    position: "absolute", inset: 0,
    transform: `scale(${zoom}) translate(${cx}px, ${cy}px)`,
    filter: blur ? `blur(${blur}px)` : undefined,
  }}>{children}</div>
);

/** 悬浮产品卡外壳 */
const FloatCard: React.FC<{
  x: number; y: number; w: number; opacity?: number; scale?: number; children: React.ReactNode;
}> = ({ x, y, w, opacity = 1, scale = 1, children }) => (
  <div style={{
    position: "absolute", left: x, top: y, width: w, opacity, transform: `scale(${scale})`,
    transformOrigin: "center",
  }}>{children}</div>
);

/** 主窗模型 */
const Widget: React.FC<{ frame: number; seq: number[] }> = ({ frame, seq }) => (
  <Win style={{ width: 450, height: 780, boxShadow: "0 44px 90px rgba(40,80,140,0.30)" }}>
    <Titlebar />
    <div style={{ flex: 1, padding: "3px 12px" }}>
      {[
        { text: "每天刷 3 道算法题", kind: "daily" as const, badge: "每日", delay: seq[0] },
        { text: "交季度报告", kind: "limited" as const, badge: "今天到期", delay: seq[1] },
        { text: "背 20 个单词", kind: "daily" as const, badge: "每日", delay: seq[2], doneAt: seq[3] },
        { text: "读《设计心理学》第三章", kind: "open" as const, badge: "不限时", delay: seq[4] },
      ].map((t, i) => {
        const appear = interpolate(frame, [t.delay, t.delay + 14], [0, 1], { ...clamp, easing: easeOut });
        const done = t.doneAt !== undefined && frame >= t.doneAt;
        const strike = done ? interpolate(frame, [t.doneAt!, t.doneAt! + 10], [0, 1], clamp) : 0;
        return (
          <div key={i} style={{ opacity: appear, transform: `translateY(${(1 - appear) * 18}px)` }}>
            <div style={{ position: "relative" }}>
              <Row text={t.text} kind={t.kind} badge={t.badge} done={done} />
              {done && (
                <div style={{
                  position: "absolute", left: 38, top: "55%", height: 2.5,
                  width: `${strike * 55}%`, background: "#223247", borderRadius: 2,
                }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
    <div style={{ flex: "none", padding: "10px 14px 14px", borderTop: "1px solid rgba(255,255,255,0.55)" }}>
      <Pills active="open" />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{
          flex: 1, height: 44, borderRadius: 10, background: "rgba(255,255,255,0.75)",
          border: "1px solid rgba(120,150,180,0.35)", display: "flex", alignItems: "center",
          padding: "0 13px", fontSize: 15, color: "#8ba0b5",
        }}>要做点什么？回车添加</div>
        <div style={{
          flex: "none", width: 44, borderRadius: 10, background: C.accent, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.8l4.6 4.4L19.5 7.2" /></svg>
        </div>
      </div>
    </div>
  </Win>
);

/** 到期提醒 toast */
const Toast: React.FC<{ opacity: number; x: number; y: number }> = ({ opacity, x, y }) => (
  <div style={{
    position: "absolute", left: x, top: y, width: 320, opacity,
    background: "rgba(255,255,255,0.95)", borderRadius: 14,
    border: "1px solid rgba(130,160,190,0.25)",
    boxShadow: "0 24px 60px rgba(30,60,100,0.30)",
    padding: "16px 18px", display: "flex", gap: 14, alignItems: "center",
    transform: `translateY(${(1 - opacity) * -20}px)`,
  }}>
    <div style={{
      flex: "none", width: 42, height: 42, borderRadius: 10, background: C.accent,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M12 4a6 6 0 016 6v3.2l1.6 2.8a1 1 0 01-.87 1.5H5.27a1 1 0 01-.87-1.5L6 13.2V10a6 6 0 016-6z" /><path d="M10 19a2 2 0 004 0" /></svg>
    </div>
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>到期提醒</div>
      <div style={{ fontSize: 12.5, color: C.inkDim, marginTop: 3 }}>交季度报告 · 今天到期</div>
    </div>
  </div>
);

export const Promo: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── S0 品牌开场（0-90）
  const s0 = f;
  const ballInS0 = spring({ frame: s0, fps, config: { damping: 11, stiffness: 100 } });
  const breath = 1 + Math.sin(s0 / 9) * 0.03;
  const tagline = interpolate(s0, [22, 46], [0, 1], { ...clamp, easing: easeOut });
  const tags = interpolate(s0, [40, 60], [0, 1], { ...clamp, easing: easeOut });
  const s0Out = interpolate(s0, [78, 90], [1, 0], clamp);

  // ── S1 主窗（90-240）
  const s1 = f - 90;
  const s1In = spring({ frame: s1, fps, config: { damping: 15, stiffness: 90 } });
  const s1X = interpolate(s1, [0, 18], [240, 0], { ...clamp, easing: easeOut });
  const s1Zoom = interpolate(s1, [0, 150], [1.0, 1.05]);
  const toastOn = interpolate(s1, [56, 70, 116, 130], [0, 1, 1, 0], clamp);
  const s1Out = interpolate(s1, [138, 150], [1, 0], clamp);

  // ── S2 三类任务（240-390）
  const s2 = f - 240;
  const s2MainX = interpolate(s2, [0, 20], [0, -280], { ...clamp, easing: easeInOut });
  const s2MainS = interpolate(s2, [0, 20], [1, 0.8], clamp);
  const cardIn = (delay: number) =>
    spring({ frame: s2 - delay, fps, config: { damping: 14, stiffness: 100 } });
  const s2Out = interpolate(s2, [138, 150], [1, 0], clamp);

  // ── S3 悬浮球（390-510）
  const s3 = f - 390;
  const ballIn = spring({ frame: s3, fps, config: { damping: 12, stiffness: 110 } });
  const slide = interpolate(s3, [10, 34], [0, 1], { ...clamp, easing: easeInOut });
  const squash = interpolate(s3, [36, 42, 52], [0, 1, 0], clamp);
  const countSwap = interpolate(s3, [56, 66], [0, 1], clamp);
  const popBack = spring({ frame: s3 - 70, fps, config: { damping: 11, stiffness: 130 } });
  const s3Zoom = interpolate(s3, [0, 30, 80, 120], [1.0, 1.25, 1.8, 1.9], {
    ...clamp, easing: easeInOut,
  });
  const s3Cx = interpolate(s3, [0, 30, 80, 120], [0, -240, -700, -760], {
    ...clamp, easing: easeInOut,
  });
  const s3Cy = interpolate(s3, [0, 30, 80, 120], [0, 30, 150, 170], {
    ...clamp, easing: easeInOut,
  });
  const s3Out = interpolate(s3, [108, 120], [1, 0], clamp);

  // ── S4 统计（510-630）
  const s4 = f - 510;
  const s4In = spring({ frame: s4, fps, config: { damping: 15, stiffness: 95 } });
  const ring = interpolate(s4, [8, 52], [0, 0.75], { ...clamp, easing: easeOut });
  const streak = Math.round(interpolate(s4, [14, 55], [0, 12], { ...clamp, easing: easeOut }));
  const s4Zoom = interpolate(s4, [0, 120], [1.08, 1.0]);
  const s4Out = interpolate(s4, [108, 120], [1, 0], clamp);

  // ── S5 尾板（630-720）
  const s5 = f - 630;
  const logoIn = spring({ frame: s5, fps, config: { damping: 12, stiffness: 110 } });
  const endOut = interpolate(s5, [78, 90], [1, 0], clamp);

  const ballCount = countSwap > 0.5 ? "2" : "3";
  const squashScale = `scaleX(${1 - squash * 0.16}) scaleY(${1 + squash * 0.06})`;

  return (
    <AbsoluteFill style={{ background: BG_GRADIENT, fontFamily: FONT }}>
      <Studio>
        {/* 配乐：24s，全程播放 */}
        <Audio src={staticFile("music.wav")} />
        <Particles f={f} />

        {/* ── S0 品牌开场 */}
        {f < 92 && (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: s0Out }}>
            <Cam zoom={interpolate(s0, [0, 90], [0.62, 1.0])} cx={0} cy={0}>
              <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ transform: `scale(${ballInS0 * breath})`, marginBottom: 40 }}>
                    <Ball size={150} count="3" style={{ margin: "0 auto" }} />
                  </div>
                  <div style={{ fontSize: 56, fontWeight: 700, color: C.ink, opacity: tagline, lineHeight: 1.35 }}>
                    再好的 TODO，<br />不如一个<span style={{ color: C.accent }}>用得下去</span>的。
                  </div>
                  <div style={{ marginTop: 36, display: "flex", gap: 10, justifyContent: "center", opacity: tags }}>
                    {["Tauri 2 + Rust", "安装包 1.3MB", "32 项单测", "MIT 开源"].map((t) => (
                      <span key={t} style={{
                        fontSize: 13, color: C.accent, background: "rgba(61,139,212,0.10)",
                        border: "1px solid rgba(61,139,212,0.3)", padding: "6px 14px", borderRadius: 999,
                      }}>{t}</span>
                    ))}
                  </div>
                </div>
              </AbsoluteFill>
            </Cam>
          </AbsoluteFill>
        )}

        {/* ── S1 主窗 + 到期提醒 */}
        {f >= 92 && f < 242 && (
          <AbsoluteFill style={{ opacity: s1Out }}>
            <SceneTitle frame={s1} main="三类任务 · 生命周期全自动" sub="每日自动重来 · 限时到期自走 · 完成沉底排序" />
            <Cam zoom={s1Zoom} cx={0} cy={0}>
              <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <FloatCard x={s1X + 510} y={130} w={450} opacity={s1In} scale={s1In}>
                  <Widget frame={s1} seq={[10, 22, 34, 118, 58]} />
                </FloatCard>
                <Toast opacity={toastOn} x={1150} y={180} />
                {checkGlow(s1, 84, 98, 108, 120)}
              </AbsoluteFill>
            </Cam>
          </AbsoluteFill>
        )}

        {/* ── S2 三类任务小卡 */}
        {f >= 242 && f < 392 && (
          <AbsoluteFill style={{ opacity: s2Out }}>
            <SceneTitle frame={s2} main="生命周期全自动" sub="你只管勾选，其余它来处理" />
            <Cam zoom={1.0} cx={0} cy={0}>
              <AbsoluteFill>
                <FloatCard x={s2MainX + 90} y={260} w={450} opacity={0.95} scale={s2MainS}>
                  <Widget frame={999} seq={[0, 0, 0, 999, 0]} />
                </FloatCard>
                {[
                  { d: 6, x: 690, t: "每日任务", line: "第二天自动满血重来，不用重新创建", icon: "↻" },
                  { d: 16, x: 1010, t: "限时任务", line: "到期自动归档走人，不用收拾残局", icon: "⏱" },
                  { d: 26, x: 1330, t: "不限时任务", line: "不完成就一直陪着你，绝不弄丢", icon: "∞" },
                ].map((c) => {
                  const inn = cardIn(c.d);
                  return (
                    <FloatCard key={c.t} x={c.x} y={310} w={280} opacity={inn}
                      scale={0.7 + inn * 0.3}>
                      <div style={{
                        background: "rgba(255,255,255,0.88)", borderRadius: 16,
                        border: "1px solid rgba(130,160,190,0.22)",
                        boxShadow: "0 24px 60px rgba(50,90,150,0.22)",
                        padding: "24px 26px", height: 240,
                        display: "flex", flexDirection: "column", gap: 12,
                      }}>
                        <div style={{
                          width: 46, height: 46, borderRadius: 12, background: "rgba(61,139,212,0.12)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 22, color: C.accent,
                        }}>{c.icon}</div>
                        <div style={{ fontSize: 21, fontWeight: 700, color: C.ink }}>{c.t}</div>
                        <div style={{ fontSize: 14.5, color: C.inkDim, lineHeight: 1.7 }}>{c.line}</div>
                      </div>
                    </FloatCard>
                  );
                })}
                <div style={{
                  position: "absolute", left: 0, right: 0, top: 640, textAlign: "center",
                  fontSize: 22, color: C.ink, opacity: cardIn(40),
                }}>
                  生命周期全自动——<b style={{ color: C.accent }}>你只管勾选</b>
                </div>
              </AbsoluteFill>
            </Cam>
          </AbsoluteFill>
        )}

        {/* ── S3 悬浮球贴边 */}
        {f >= 392 && f < 512 && (
          <AbsoluteFill style={{ opacity: s3Out }}>
            <SceneTitle frame={s3} main="悬浮球 · 收放自如" sub="拖哪都行 · 松手自动贴边 · 点击展开" />
            <Cam zoom={s3Zoom} cx={s3Cx} cy={s3Cy}>
              <AbsoluteFill>
                <FloatCard x={interpolate(s3, [0, 14], [540, -520], { ...clamp, easing: easeInOut })} y={170} w={450}>
                  <Widget frame={999} seq={[0, 0, 0, 999, 0]} />
                </FloatCard>
                <div style={{
                  position: "absolute", right: 380, top: 0, bottom: 110, width: 3,
                  background: "linear-gradient(rgba(255,255,255,0),rgba(255,255,255,0.9),rgba(255,255,255,0))",
                  opacity: interpolate(s3, [6, 16], [0, 1], clamp),
                }} />
                {slide > 0 && slide < 1 && [0.35, 0.6, 0.85].map((k, i) => {
                  const gx = interpolate(slide, [0, 1], [700 + k * 300, 1180 + k * 240], { ...clamp, easing: easeInOut }) - 75;
                  return (
                    <FloatCard key={i} x={gx} y={430 - 75} w={150} opacity={(1 - slide) * 0.25 * (i + 1) / 3}>
                      <Ball size={150} count="3" />
                    </FloatCard>
                  );
                })}
                {(() => {
                  // 贴点与发光边线对齐：线在 x=1540（绝对坐标），球贴边时球心 = 线 - 5.5
                  const bx3 = interpolate(s3, [10, 34, 36, 44], [625, 1280, 1397, 1397], {
                    ...clamp, easing: easeInOut,
                  });
                  const by3 = interpolate(s3, [10, 34], [825, 355], { ...clamp, easing: easeInOut });
                  const sx = 1 - squash * 0.16;
                  const sy = 1 + squash * 0.06;
                  return (
                    <FloatCard x={bx3} y={by3} w={260} scale={ballIn * (popBack > 0 ? 1 + popBack * 0.04 : 1)}>
                      <div style={{ transform: `scaleX(${sx}) scaleY(${sy})`, transformOrigin: "right center" }}>
                        <Ball size={260} count={ballCount} />
                      </div>
                    </FloatCard>
                  );
                })()}
                <div style={{
                  position: "absolute", left: 0, right: 0, top: 810, textAlign: "center",
                  fontSize: 24, color: C.ink, opacity: interpolate(s3, [46, 58], [0, 1], clamp),
                }}>
                  露 55% · <b style={{ color: C.accent }}>不挡屏幕</b> · 悬停即读
                </div>
              </AbsoluteFill>
            </Cam>
          </AbsoluteFill>
        )}

        {/* ── S4 统计 */}
        {f >= 512 && f < 632 && (
          <AbsoluteFill style={{ opacity: s4Out }}>
            <SceneTitle frame={s4} main="坚持与健康度，它替你记账" sub="全部基于本地归档数据，随开随看" />
            <Cam zoom={s4Zoom} cx={0} cy={0}>
              <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <FloatCard x={710} y={170} w={500} opacity={s4In} scale={s4In}>
                  <div style={{
                    width: 500, background: "rgba(255,255,255,0.9)", borderRadius: 18,
                    border: "1px solid rgba(130,160,190,0.22)",
                    boxShadow: "0 40px 90px rgba(50,90,150,0.30)", padding: 28, fontFamily: FONT,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
                      <div style={{
                        width: 100, height: 100, borderRadius: "50%", flex: "none", position: "relative",
                        background: `conic-gradient(${C.accent} ${ring * 100}%, rgba(120,150,180,0.2) 0)`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <div style={{ position: "absolute", inset: 8, borderRadius: "50%", background: "rgba(250,253,255,0.97)" }} />
                        <b style={{ position: "relative", fontSize: 20, color: C.ink }}>3/4</b>
                      </div>
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 600, color: C.ink }}>今日完成</div>
                        <div style={{ fontSize: 14, color: C.inkDim, marginTop: 5 }}>剩余 1 件 · 加油</div>
                      </div>
                    </div>
                    <div style={{ borderTop: "1px solid rgba(120,150,180,0.15)", marginTop: 20, paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, color: C.inkDim }}>
                      <span><b style={{ fontSize: 30, color: C.accent, marginRight: 8 }}>{streak}</b>天 连续打卡</span>
                      <span>最长 18 天</span>
                    </div>
                    <div style={{ borderTop: "1px solid rgba(120,150,180,0.15)", marginTop: 16, paddingTop: 16, display: "grid", gridTemplateColumns: "repeat(14,1fr)", gap: 6 }}>
                      {Array.from({ length: 28 }).map((_, i) => {
                        const on = interpolate(s4, [18 + i * 0.9, 26 + i * 0.9], [0, 1], clamp);
                        const lvl = i % 7 === 3 ? 0.15 : i % 3 === 0 ? 0.45 : 0.85;
                        return (
                          <div key={i} style={{
                            aspectRatio: "1", borderRadius: 3, opacity: on,
                            background: `rgba(61,139,212,${lvl})`,
                          }} />
                        );
                      })}
                    </div>
                    <div style={{ borderTop: "1px solid rgba(120,150,180,0.15)", marginTop: 18, paddingTop: 14, fontSize: 14, color: C.inkDim }}>
                      {["每日", "按期率"].map((t, i) => {
                        const w = interpolate(s4, [40 + i * 12, 62 + i * 12], [0, i === 0 ? 75 : 88], {
                          ...clamp, easing: easeOut,
                        });
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                            <span style={{ width: 60 }}>{t}</span>
                            <div style={{ flex: 1, height: 7, borderRadius: 4, background: "rgba(120,150,180,0.15)" }}>
                              <div style={{
                                height: "100%", width: `${w}%`, borderRadius: 4,
                                background: i === 0 ? C.accent : C.green,
                              }} />
                            </div>
                            <b style={{ color: C.ink, width: 44, textAlign: "right" }}>{Math.round(w)}%</b>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </FloatCard>
                <FloatCard x={330} y={260} w={300} opacity={s4In} scale={0.95}>
                  <div style={{
                    background: "rgba(255,255,255,0.9)", borderRadius: 14, padding: "18px 22px",
                    border: "1px solid rgba(130,160,190,0.2)", boxShadow: "0 20px 50px rgba(50,90,150,0.18)",
                    fontSize: 14, color: C.ink,
                  }}>
                    <div style={{ fontSize: 12, color: C.inkDim, marginBottom: 6 }}>连续打卡</div>
                    <b style={{ fontSize: 30, color: C.accent }}>{streak}</b> 天
                  </div>
                </FloatCard>
                <FloatCard x={1310} y={560} w={300} opacity={s4In} scale={0.95}>
                  <div style={{
                    background: "rgba(255,255,255,0.9)", borderRadius: 14, padding: "18px 22px",
                    border: "1px solid rgba(130,160,190,0.2)", boxShadow: "0 20px 50px rgba(50,90,150,0.18)",
                    fontSize: 14, color: C.ink,
                  }}>
                    <div style={{ fontSize: 12, color: C.inkDim, marginBottom: 6 }}>30 天热力图</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(10,1fr)", gap: 4 }}>
                      {Array.from({ length: 20 }).map((_, i) => (
                        <div key={i} style={{
                          aspectRatio: "1", borderRadius: 2,
                          background: `rgba(61,139,212,${i % 4 === 0 ? 0.15 : 0.35 + (i % 3) * 0.2})`,
                        }} />
                      ))}
                    </div>
                  </div>
                </FloatCard>
              </AbsoluteFill>
            </Cam>
          </AbsoluteFill>
        )}

        {/* ── S5 尾板 */}
        {f >= 632 && (
          <AbsoluteFill style={{ opacity: endOut }}>
            <Cam zoom={interpolate(s5, [0, 90], [0.94, 1.04])} cx={0} cy={0}>
              <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "center", transform: `scale(${logoIn})` }}>
                  <Ball size={150} count="0" done style={{ margin: "0 auto 44px" }} />
                  <div style={{ fontSize: 72, fontWeight: 700, color: C.ink }}>MyToDo</div>
                  <div style={{ marginTop: 20, fontSize: 22, color: C.inkDim }}>
                    再好的 TODO，不如一个用得下去的。
                  </div>
                  <div style={{ marginTop: 34, display: "flex", gap: 12, justifyContent: "center" }}>
                    {["磨砂玻璃小组件", "自动生命周期", "贴边悬浮球", "统计记账"].map((t) => (
                      <span key={t} style={{
                        fontSize: 13, color: C.inkDim, background: "rgba(255,255,255,0.7)",
                        border: "1px solid rgba(130,160,190,0.3)", padding: "6px 16px", borderRadius: 999,
                      }}>{t}</span>
                    ))}
                  </div>
                  <div style={{ marginTop: 30, fontSize: 16, color: C.accent, letterSpacing: 3 }}>
                    github.com/jovanzhang6/MyToDo · 开源 · MIT · 安装包 1.3MB
                  </div>
                </div>
              </AbsoluteFill>
            </Cam>
          </AbsoluteFill>
        )}
      </Studio>
    </AbsoluteFill>
  );
};

/** S1 勾选完成时的绿色强调框 */
function checkGlow(frame: number, a: number, b: number, c: number, d: number) {
  const on = interpolate(frame, [a, b, c, d], [0, 1, 1, 0], clamp);
  if (on <= 0) return null;
  return (
    <div style={{
      position: "absolute", left: 620, top: 320, width: 560, height: 96,
      border: `2.5px solid rgba(88,169,66,${0.8 * on})`, borderRadius: 14,
      transform: `scale(${0.96 + on * 0.04})`,
    }} />
  );
}
