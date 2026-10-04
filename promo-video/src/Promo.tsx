// 宣传片主合成：24s @30fps，五场 + 电影感镜头（推拉/焦点/穿越转场）
import React from "react";
import {
  AbsoluteFill, Audio, Easing, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig,
} from "remotion";
import { C, FONT } from "./theme";

// Remotion Audio 类型与 @types/react 19 的成员要求偶发不合，包一层收敛类型
const RAudio = Audio as unknown as React.FC<{ src: string }>;
import { Ball, Pills, Row, Titlebar, Win } from "./ui";

const BG_GRADIENT = "linear-gradient(135deg,#eaf5ea 0%,#dcebf7 55%,#cfe3f5 100%)";

/** 电影感镜头包装：scale 推拉 + 平移 + 入场焦点虚化 */
const Cam: React.FC<{
  zoom: number; cx: number; cy: number; blur?: number; children: React.ReactNode;
}> = ({ zoom, cx, cy, blur = 0, children }) => (
  <div style={{
    position: "absolute", inset: 0,
    transform: `scale(${zoom}) translate(${cx}px, ${cy}px)`,
    filter: blur ? `blur(${blur}px)` : undefined,
  }}>{children}</div>
);

/** 主窗模型（任务集可配置） */
const Widget: React.FC<{ frame: number; seq: number[] }> = ({ frame, seq }) => (
  <Win>
    <Titlebar />
    <div style={{ flex: 1, padding: "2px 8px" }}>
      {[
        { text: "每天刷 3 道算法题", kind: "daily" as const, badge: "每日", delay: seq[0] },
        { text: "交季度报告", kind: "limited" as const, badge: "今天到期", delay: seq[1] },
        { text: "背 20 个单词", kind: "daily" as const, badge: "每日", delay: seq[2], doneAt: seq[3] },
        { text: "读《设计心理学》第三章", kind: "open" as const, badge: "不限时", delay: seq[4] },
      ].map((t, i) => {
        const appear = interpolate(frame, [t.delay, t.delay + 12], [0, 1], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
        const done = t.doneAt !== undefined && frame >= t.doneAt;
        const strike = done
          ? interpolate(frame, [t.doneAt!, t.doneAt! + 8], [0, 1], {
              extrapolateLeft: "clamp", extrapolateRight: "clamp",
            })
          : 0;
        return (
          <div key={i} style={{ opacity: appear, transform: `translateY(${(1 - appear) * 14}px)` }}>
            <div style={{ position: "relative" }}>
              <Row text={t.text} kind={t.kind} badge={t.badge} done={done} />
              {done && (
                <div style={{
                  position: "absolute", left: 30, top: "55%", height: 2,
                  width: `${strike * 55}%`, background: "#223247", borderRadius: 1,
                }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
    <div style={{ flex: "none", padding: "8px 10px 10px", borderTop: "1px solid rgba(255,255,255,0.55)" }}>
      <Pills active="open" />
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{
          flex: 1, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.7)",
          border: "1px solid rgba(120,150,180,0.35)", display: "flex", alignItems: "center",
          padding: "0 10px", fontSize: 12, color: "#8ba0b5",
        }}>要做点什么？回车添加</div>
        <div style={{
          flex: "none", width: 34, borderRadius: 8, background: C.accent, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
        }}>✓</div>
      </div>
    </div>
  </Win>
);

export const Promo: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── S1 标题（0-105）：镜头缓推
  const t1 = f;
  const titleIn = interpolate(t1, [6, 30], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
  });
  const titleOut = interpolate(t1, [92, 105], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const s1Zoom = interpolate(t1, [0, 105], [1.0, 1.08]);

  // ── S2 主窗（105-295）：左入 + 焦点虚化进入 + 推镜
  const s2 = f - 105;
  const s2In = interpolate(s2, [0, 16], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
  });
  const s2Blur = interpolate(s2, [0, 14], [10, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const s2Zoom = interpolate(s2, [0, 190], [1.02, 1.07]);
  const s2Out = interpolate(s2, [176, 190], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // ── S3 悬浮球（295-450）：主窗缩没 → 球滑到边 → 缩进贴边 → 悬停滑出
  const s3 = f - 295;
  const mainShrink = spring({ frame: s3, fps, config: { damping: 14, stiffness: 120 } });
  const tuck = interpolate(s3, [42, 58], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic),
  });
  const peek = interpolate(s3, [70, 86], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic),
  });
  // 球位置：主窗处 → 屏幕右缘 → 藏 45% → 悬停滑出全露
  const bx = interpolate(s3, [0, 14, 40, 58, 86], [1210, 1520, 1836, 1872, 1836], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const by = interpolate(s3, [0, 14], [520, 300], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const s3Zoom = interpolate(s3, [30, 90], [1.0, 1.12]);
  const s3Out = interpolate(s3, [138, 155], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // ── S4 统计（450-600）：上浮 + 焦点 + 数据动效
  const s4 = f - 450;
  const s4In = interpolate(s4, [0, 16], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
  });
  const s4Blur = interpolate(s4, [0, 14], [10, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ring = interpolate(s4, [10, 55], [0, 0.75], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
  });
  const streak = Math.round(interpolate(s4, [18, 60], [0, 12], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
  }));
  const s4Zoom = interpolate(s4, [0, 150], [1.06, 1.0]);
  const s4Out = interpolate(s4, [135, 150], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // ── S5 尾板（600-720）
  const s5 = f - 600;
  const logoIn = spring({ frame: s5, fps, config: { damping: 12, stiffness: 110 } });
  const endOut = interpolate(s5, [105, 120], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: BG_GRADIENT, fontFamily: FONT }}>
      <RAudio src={staticFile("music.wav")} />

      {/* S1 标题 */}
      {f < 108 && (
        <Cam zoom={s1Zoom} cx={0} cy={0}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: titleIn * titleOut }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 15, letterSpacing: 8, color: C.inkDim, marginBottom: 26 }}>MYTODO · OPEN SOURCE</div>
              <div style={{ fontSize: 64, fontWeight: 700, color: C.ink, lineHeight: 1.3 }}>
                再好的 TODO，<br />不如一个<span style={{ color: C.accent }}>用得下去</span>的。
              </div>
              <div style={{ marginTop: 26, fontSize: 17, color: C.inkDim }}>
                常驻桌面的磨砂玻璃小组件 · 每日任务自动重来 · 限时任务到期自走
              </div>
            </div>
          </AbsoluteFill>
        </Cam>
      )}

      {/* S2 主窗：任务流 */}
      {f >= 105 && f < 295 && (
        <Cam zoom={s2Zoom} cx={0} cy={0} blur={s2Blur}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: s2In * s2Out }}>
            <Widget frame={s2} seq={[8, 16, 24, 96, 40]} />
          </AbsoluteFill>
        </Cam>
      )}

      {/* S3 悬浮球：收球两段动画 + 悬停 */}
      {f >= 295 && f < 450 && (
        <Cam zoom={s3Zoom} cx={0} cy={0}>
          <AbsoluteFill style={{ opacity: s3Out }}>
            {/* 主窗缩没（变形错觉） */}
            {s3 < 16 && (
              <AbsoluteFill style={{
                alignItems: "center", justifyContent: "center",
                opacity: 1 - mainShrink,
                transform: `scale(${1 - mainShrink * 0.5})`,
                filter: `blur(${mainShrink * 6}px)`,
              }}>
                <Widget frame={999} seq={[0, 0, 0, 999, 0]} />
              </AbsoluteFill>
            )}
            {/* 球：滑到边 → 缩进藏 45% → 悬停滑出全露 */}
            <div style={{
              position: "absolute", left: bx - 42, top: by - 42,
              filter: "drop-shadow(0 16px 30px rgba(30,60,100,0.4))",
            }}>
              <Ball size={84} count={s3 > 60 ? "2" : "3"} />
            </div>
            {/* 贴边藏出屏外的部分：用背景色遮罩模拟 */}
            {tuck > 0 && peek < 1 && (
              <div style={{
                position: "absolute", right: 0, top: 0, bottom: 0,
                width: interpolate(tuck, [0, 1], [0, 38], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                background: BG_GRADIENT, opacity: 0.98,
              }} />
            )}
            {peek > 0 && (
              <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 38 * peek, background: BG_GRADIENT, opacity: 0.98 }} />
            )}
          </AbsoluteFill>
        </Cam>
      )}

      {/* S4 统计 */}
      {f >= 450 && f < 600 && (
        <Cam zoom={s4Zoom} cx={0} cy={0} blur={s4Blur}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: s4In * s4Out }}>
            <div style={{
              width: 340, background: C.glass, borderRadius: 10, border: "1px solid rgba(130,160,190,0.18)",
              boxShadow: "0 30px 70px rgba(50,90,150,0.28)", padding: 14, fontFamily: FONT,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 64, height: 64, borderRadius: "50%", flex: "none",
                  background: `conic-gradient(${C.accent} ${ring * 100}%, rgba(120,150,180,0.2) 0)`,
                  display: "flex", alignItems: "center", justifyContent: "center", position: "relative",
                }}>
                  <div style={{ position: "absolute", inset: 6, borderRadius: "50%", background: "rgba(250,253,255,0.95)" }} />
                  <b style={{ position: "relative", fontSize: 13, color: C.ink }}>3/4</b>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>今日完成</div>
                  <div style={{ fontSize: 11.5, color: C.inkDim, marginTop: 3 }}>剩余 1 件 · 加油</div>
                </div>
              </div>
              <div style={{ borderTop: "1px solid rgba(120,150,180,0.15)", marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: C.inkDim }}>
                <span><b style={{ fontSize: 20, color: C.accent, marginRight: 4 }}>{streak}</b>天 连续打卡</span>
                <span>最长 18 天</span>
              </div>
              <div style={{ borderTop: "1px solid rgba(120,150,180,0.15)", marginTop: 10, paddingTop: 10, display: "grid", gridTemplateColumns: "repeat(14,1fr)", gap: 4 }}>
                {Array.from({ length: 28 }).map((_, i) => {
                  const on = interpolate(s4, [20 + i * 1.2, 26 + i * 1.2], [0, 1], {
                    extrapolateLeft: "clamp", extrapolateRight: "clamp",
                  });
                  const lvl = i % 7 === 3 ? 0.15 : i % 3 === 0 ? 0.45 : 0.85;
                  return (
                    <div key={i} style={{
                      aspectRatio: "1", borderRadius: 2, opacity: on,
                      background: `rgba(61,139,212,${lvl})`,
                    }} />
                  );
                })}
              </div>
              <div style={{ borderTop: "1px solid rgba(120,150,180,0.15)", marginTop: 10, paddingTop: 8, fontSize: 10.5, color: C.inkDim }}>
                {["每日 75%", "按期率 88%"].map((t, i) => {
                  const w = interpolate(s4, [40 + i * 10, 60 + i * 10], [0, i === 0 ? 75 : 88], {
                    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
                  });
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <span style={{ width: 46 }}>{t.split(" ")[0]}</span>
                      <div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(120,150,180,0.15)" }}>
                        <div style={{
                          height: "100%", width: `${w}%`, borderRadius: 3,
                          background: i === 0 ? C.accent : C.green,
                        }} />
                      </div>
                      <b style={{ color: C.ink, width: 34, textAlign: "right" }}>{Math.round(w)}%</b>
                    </div>
                  );
                })}
              </div>
            </div>
          </AbsoluteFill>
        </Cam>
      )}

      {/* S5 尾板 */}
      {f >= 600 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: endOut }}>
          <Cam zoom={interpolate(s5, [0, 120], [0.94, 1.03])} cx={0} cy={0}>
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", transform: `scale(${logoIn})` }}>
                <Ball size={110} count="0" done style={{ margin: "0 auto 30px" }} />
                <div style={{ fontSize: 54, fontWeight: 700, color: C.ink }}>MyToDo</div>
                <div style={{ marginTop: 14, fontSize: 18, color: C.inkDim }}>
                  再好的 TODO，不如一个用得下去的。
                </div>
                <div style={{ marginTop: 22, fontSize: 13.5, color: C.accent, letterSpacing: 2 }}>
                  github.com/jovanzhang6/MyToDo · 开源 · MIT · 安装包 1.3MB
                </div>
              </div>
            </AbsoluteFill>
          </Cam>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
