// MyToDo 宣传片配乐 v4 —— 24s @44.1kHz mono WAV
// 结构：100 BPM，C–G–Am–F 进行 ×2 + C 收尾
// 0-6s 垫底 → 6s 起琶音 → 7.2s 起低音 → 14.4s 起 hat 节拍 → 22.6s 收束长音
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SR = 44100;
const DUR = 24;
const N = SR * DUR;
const BPM = 100;
const BEAT = 60 / BPM; // 0.6s
const BAR = BEAT * 4; // 2.4s

const buf = new Float64Array(N);

const add = (start, len, gen) => {
  const s0 = Math.floor(start * SR);
  const n = Math.floor(len * SR);
  for (let i = 0; i < n; i++) {
    const idx = s0 + i;
    if (idx < 0 || idx >= N) continue;
    buf[idx] += gen(i / SR);
  }
};

const tri = (f) => (t) => {
  const p = (t * f) % 1;
  return 4 * Math.abs(p - 0.5) - 1;
};
const sin = (f) => (t) => Math.sin(2 * Math.PI * f * t);

// 和弦（Hz）：C / G / Am / F
const CH = {
  C: { pad: [261.63, 329.63, 392.0], bass: 130.81, arp: [261.63, 329.63, 392.0, 523.25] },
  G: { pad: [196.0, 246.94, 293.66], bass: 98.0, arp: [196.0, 246.94, 293.66, 392.0] },
  Am: { pad: [220.0, 261.63, 329.63], bass: 110.0, arp: [220.0, 261.63, 329.63, 440.0] },
  F: { pad: [174.61, 220.0, 261.63], bass: 87.31, arp: [174.61, 220.0, 261.63, 349.23] },
};
const PROG = ["C", "G", "Am", "F", "C", "G", "Am", "F", "C", "C"];

// ── 垫底：每个 bar 三角波和弦，软起软收
for (let b = 0; b < PROG.length; b++) {
  const t0 = b * BAR;
  const ch = CH[PROG[b]];
  for (const f of ch.pad) {
    add(t0, BAR + 0.25, (t) => {
      const env = Math.min(t / 0.3, 1) * Math.min((BAR + 0.25 - t) / 0.35, 1);
      return tri(f)(t) * 0.042 * env;
    });
  }
}

// ── 琶音：6s 起，八分音符拨弦（正弦 + 指数衰减），上行-下行循环
const ARP_START = 6.0;
for (let b = 0; b < PROG.length; b++) {
  const t0 = b * BAR;
  if (t0 + BAR < ARP_START) continue;
  const ch = CH[PROG[b]];
  for (let e = 0; e < 8; e++) {
    const te = t0 + e * (BEAT / 2);
    if (te < ARP_START) continue;
    const f = ch.arp[[0, 1, 2, 3, 2, 1, 2, 3][e]];
    add(te, 0.5, (t) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 6) * 0.085);
  }
}

// ── 低音：7.2s 起，每小节 1/3 拍
const BASS_START = 7.2;
for (let b = 0; b < PROG.length; b++) {
  const t0 = b * BAR;
  if (t0 + BAR < BASS_START) continue;
  const f = CH[PROG[b]].bass;
  for (const half of [0, 2]) {
    const te = t0 + half * BEAT;
    if (te < BASS_START) continue;
    add(te, BEAT * 0.9, (t) => sin(f)(t) * Math.exp(-t * 3) * 0.13);
  }
}

// ── Hat：14.4s 起，反拍短噪声
const HAT_START = 14.4;
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
for (let b = 0; b < PROG.length; b++) {
  const t0 = b * BAR;
  for (let e = 0; e < 8; e++) {
    const te = t0 + e * (BEAT / 2) + BEAT / 4;
    if (te < HAT_START) continue;
    add(te, 0.06, (t) => (rnd() * 2 - 1) * Math.exp(-t * 90) * 0.05);
  }
}

// ── 收束长音：22.8s 低音 C
add(22.8, 1.2, (t) => sin(65.41)(t) * Math.min(t / 0.08, 1) * 0.1);

// ── 全局淡入 / 淡出
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let g = 1;
  if (t < 0.8) g = t / 0.8;
  if (t > 22.6) g = Math.max(0, 1 - (t - 22.6) / 1.4);
  buf[i] *= g;
}

// ── 峰值归一化到 0.88
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const k = 0.88 / peak;

// ── 写 16-bit mono WAV
const out = Buffer.alloc(44 + N * 2);
out.write("RIFF", 0);
out.writeUInt32LE(36 + N * 2, 4);
out.write("WAVE", 8);
out.write("fmt ", 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);
out.writeUInt16LE(1, 22);
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 2, 28);
out.writeUInt16LE(2, 32);
out.writeUInt16LE(16, 34);
out.write("data", 36);
out.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * k)) * 32767), 44 + i * 2);
}

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "..", "public", "music.wav"), out);
console.log("music.wav written:", N, "samples,", DUR + "s");
