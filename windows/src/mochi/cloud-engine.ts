// Cloud Mascot — replaces Mochi with a soft, animated cloud character.
// Reuses the same animation framework (BotEngine) but draws a cloud instead.

import { Ease, lerp, type EaseFn } from "../core/anim";
import { Sound } from "../core/sound";
import type { BotEmoteName, BotStateName } from "../core/layout";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CloudEyeShape =
  | "dot" | "wide" | "happy" | "closed" | "sparkle" | "sleepy" | "wink";

export type CloudBadgeKind = "dots" | "bang" | "question" | "dot" | "arrow" | "sparkle";

export interface CloudBadge {
  kind: CloudBadgeKind;
  color: CloudRGB;
}

export type CloudRGB = readonly [number, number, number]; // components 0…1

export type CloudTweenKey = readonly [target: number, durationMs: number, ease: EaseFn];

interface CloudTween {
  prop: CloudPropKey;
  keys: CloudTweenKey[];
  index: number;
  from: number;
  startMs: number;
  onComplete?: () => void;
}

type CloudPropKey =
  | "yaw" | "pitch" | "roll" | "tilt" | "open" | "sx" | "sy"
  | "oy" | "ox" | "tint" | "morph" | "drift" | "blush" | "es" | "badgeS"
  | "puffPhase";

interface CloudStateCfg {
  color: CloudRGB;
  tint: number;
  eye: CloudEyeShape;
  badge: CloudBadge | null;
  bounces: boolean;
  drifts: boolean;
  breathes: boolean;
  zz: boolean;
  sparkle: boolean;
  look: readonly [number, number] | null;
  tilt: number;
}

interface CloudParticle {
  type: "sparkle" | "droplet" | "puff" | "z";
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; rot: number; size: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EYE_W = 0.18;
const EYE_H = 0.22;
const EYE_SP = 0.32;
const EYE_P = -0.08;

const CLOUD_WHITE: CloudRGB = [0.98, 0.98, 1.0];
const CLOUD_LIGHT: CloudRGB = [0.85, 0.88, 0.95];
const CLOUD_SHADOW: CloudRGB = [0.65, 0.7, 0.82];

const CC = {
  idle: [0.92, 0.94, 1.0] as CloudRGB,
  working: [0.3, 0.7, 1.0] as CloudRGB,
  thinking: [0.6, 0.45, 0.98] as CloudRGB,
  searching: [0.4, 0.5, 0.95] as CloudRGB,
  approval: [1.0, 0.75, 0.25] as CloudRGB,
  question: [0.2, 0.85, 1.0] as CloudRGB,
  error: [1.0, 0.35, 0.4] as CloudRGB,
  finished: [0.25, 0.9, 0.65] as CloudRGB,
  ratelimit: [1.0, 0.65, 0.3] as CloudRGB,
  sleeping: [0.65, 0.7, 0.85] as CloudRGB,
  dizzy: [1.0, 0.5, 0.8] as CloudRGB,
};

const cloudBase = {
  bounces: false, drifts: false, breathes: false, zz: false, sparkle: false,
  look: null, tilt: 0,
};

export const CLOUD_STATES: Record<BotStateName, CloudStateCfg> = {
  idle: { ...cloudBase, color: CC.idle, tint: 0, eye: "dot", badge: null },
  working: { ...cloudBase, color: CC.working, tint: 0.6, eye: "wide", badge: { kind: "dots", color: CC.working }, drifts: true },
  thinking: { ...cloudBase, color: CC.thinking, tint: 0.6, eye: "dot", badge: { kind: "dots", color: CC.thinking }, look: [0.4, 0.4] },
  searching: { ...cloudBase, color: CC.searching, tint: 0.6, eye: "sparkle", badge: { kind: "dots", color: CC.searching }, drifts: true, sparkle: true },
  approval: { ...cloudBase, color: CC.approval, tint: 0.7, eye: "wide", badge: { kind: "bang", color: CC.approval }, bounces: true },
  question: { ...cloudBase, color: CC.question, tint: 0.65, eye: "dot", badge: { kind: "question", color: CC.question }, tilt: 0.15 },
  error: { ...cloudBase, color: CC.error, tint: 0.7, eye: "closed", badge: { kind: "dot", color: CC.error } },
  finished: { ...cloudBase, color: CC.finished, tint: 0.3, eye: "happy", badge: { kind: "sparkle", color: CC.finished } },
  ratelimit: { ...cloudBase, color: CC.ratelimit, tint: 0.6, eye: "sleepy", badge: { kind: "dot", color: CC.ratelimit }, sparkle: true },
  sleeping: { ...cloudBase, color: CC.sleeping, tint: 0.25, eye: "closed", badge: null, breathes: true, zz: true },
  dizzy: { ...cloudBase, color: CC.dizzy, tint: 0.6, eye: "sparkle", badge: null },
};

export const CLOUD_STATE_SOUND: Partial<Record<BotStateName, string>> = {
  working: "work", thinking: "think", searching: "search", approval: "approval",
  question: "question", error: "error", finished: "finish", ratelimit: "rate",
  sleeping: "sleep", dizzy: "dizzy",
};

const CLOUD_EMOTE_EYE: Record<BotEmoteName, CloudEyeShape> = {
  love: "sparkle", surprised: "wide", proud: "happy", wink: "wink",
  yawn: "sleepy", happy: "happy", annoyed: "closed",
};

// ── Small helpers ─────────────────────────────────────────────────────────────

const now = () => performance.now() / 1000;

export function hexToCloudRGB(hex: string): CloudRGB {
  const h = hex.replace("#", "");
  const v = parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const rgba = (c: CloudRGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

const mix3 = (a: CloudRGB, b: CloudRGB, t: number): CloudRGB => [
  lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t),
];

function roundRectPath(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  const r = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

function cloudPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, morph: number) {
  // Draw a soft cloud shape using multiple overlapping circles
  const puffCount = 5 + Math.floor(morph * 3);
  const baseR = r;
  
  ctx.beginPath();
  
  // Main cloud body - overlapping circles
  const centers = [
    { x: 0, y: 0, r: baseR * 0.9 },
    { x: -baseR * 0.6, y: -baseR * 0.2, r: baseR * 0.65 },
    { x: baseR * 0.6, y: -baseR * 0.2, r: baseR * 0.65 },
    { x: -baseR * 0.3, y: baseR * 0.3, r: baseR * 0.55 },
    { x: baseR * 0.3, y: baseR * 0.3, r: baseR * 0.55 },
    { x: 0, y: baseR * 0.5, r: baseR * 0.5 },
    { x: -baseR * 0.8, y: baseR * 0.1, r: baseR * 0.45 },
    { x: baseR * 0.8, y: baseR * 0.1, r: baseR * 0.45 },
  ];
  
  // Build union of circles for cloud shape
  for (let i = 0; i < Math.min(puffCount, centers.length); i++) {
    const c = centers[i];
    ctx.moveTo(cx + c.x + c.r, cy + c.y);
    ctx.arc(cx + c.x, cy + c.y, c.r, 0, Math.PI * 2);
  }
  ctx.closePath();
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class CloudEngine {
  /** Solid body colour for integration pills (null = cloud gradient). */
  bodyColor: CloudRGB | null = null;
  /** Update hint (blue arrow) while waiting. */
  private updateHint: CloudRGB | null = null;

  // Animated state
  yaw = 0; pitch = 0; roll = 0; tilt = 0; open = 1;
  sx = 1; sy = 1; oy = 0; ox = 0;
  tint = 0; morph = 0; drift = 0; blush = 0; es = 1; badgeS = 0; puffPhase = 0;

  // Targets
  tgYaw = 0; tgPitch = 0; tgTilt = 0; tgSy = 1; tgSx = 1; tgEs = 1; tgDrift = 0; tgPuff = 0;

  // State
  state: BotStateName = "idle";
  cfg: CloudStateCfg = CLOUD_STATES.idle;

  eyeOverride: CloudEyeShape | null = null;
  eyeOverrideUntil = 0;
  permanentEye: CloudEyeShape | null = null;
  permanentEmote: BotEmoteName | null = null;

  badge: CloudBadge | null = null;
  private badgeKey = "none";
  private badgeToken = 0;

  private tweens = new Map<CloudPropKey, CloudTween>();
  private locks = new Set<CloudPropKey>();
  private particles: CloudParticle[] = [];

  lookX = 0;
  lookY = 0;

  lastTime = now();
  private t0 = now() - Math.random() * 5;
  private nextBlink = now() + 2 + Math.random() * 3;
  private nextDrift = now() + 3 + Math.random() * 4;
  private nextAmbient = 0;
  private nextPuff = now() + 1 + Math.random() * 2;

  /** Fired when three slaps land inside 1.7 s (→ dizzy). */
  onDizzy: (() => void) | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  setState(next: BotStateName, force = false) {
    if (this.state === next && !force) return;
    const prev = this.state;
    this.state = next;
    this.cfg = CLOUD_STATES[next];
    this.colT = this.cfg.color;
    if (!this.locks.has("tint")) this.tint = this.cfg.tint;
    if (!this.locks.has("tilt")) this.tgTilt = this.cfg.tilt;
    this.setBadge(this.stateBadge());

    switch (next) {
      case "finished":
        this.doRoll(950, 1);
        setTimeout(() => this.emit("sparkle", 5), 500);
        break;
      case "error":
        this.anim("ox", [
          [0.08, 50, Ease.out], [-0.08, 70, Ease.inOut],
          [0.05, 70, Ease.inOut], [0, 90, Ease.out],
        ]);
        break;
      case "approval":
        this.anim("oy", [[-0.2, 150, Ease.out], [0, 300, Ease.back]]);
        break;
      case "dizzy":
        this.doRoll(1300, 2);
        break;
      case "question":
        this.blink();
        break;
      case "ratelimit":
        this.emit("droplet", 1);
        break;
      default:
        if (prev !== "idle" || next !== "idle") this.blink();
    }
  }

  setUpdateHint(color: CloudRGB | null) {
    const was = this.updateHint;
    const same = color === was || (color != null && was != null && color.every((c, i) => c === was[i]));
    if (same) return;
    this.updateHint = color;
    this.setBadge(this.stateBadge());
  }

  get showsUpdateHint(): boolean {
    return this.updateHint != null && (this.state === "idle" || this.state === "sleeping");
  }

  private stateBadge(): CloudBadge | null {
    if (this.showsUpdateHint && this.updateHint) return { kind: "arrow", color: this.updateHint };
    return this.cfg.badge;
  }

  setBadge(b: CloudBadge | null) {
    const key = b ? `${b.kind}-${b.color.join(",")}` : "none";
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    const tok = ++this.badgeToken;
    this.anim("badgeS", [[0, 90, Ease.inOut]]);
    setTimeout(() => {
      if (tok !== this.badgeToken) return;
      this.badge = b;
      if (b) this.anim("badgeS", [[1, 280, Ease.back]]);
    }, 100);
  }

  blink() {
    if (this.locks.has("open")) return;
    this.anim("open", [[0.06, 70, Ease.inOut], [1, 130, Ease.out]]);
  }

  squash() {
    this.anim("sy", [[0.8, 70, Ease.out], [1.15, 130, Ease.out], [1, 170, Ease.inOut]]);
    this.anim("sx", [[1.15, 70, Ease.out], [0.95, 130, Ease.out], [1, 170, Ease.inOut]]);
  }

  /** Cloud puff - expands and releases. */
  puff() {
    this.anim("puffPhase", [[1, 150, Ease.out], [0, 400, Ease.inOut]]);
    this.emit("puff", 3);
    this.blink();
  }

  slap() {
    if (this.state === "dizzy") return;
    const t = now();
    this.emit("droplet", 2);
    this.squash();
    if (this.cfg.drifts) {
      this.anim("drift", [[0.3, 200, Ease.out], [0, 500, Ease.inOut]]);
    }
  }

  doRoll(durationMs: number, turns: number) {
    this.roll = 0;
    this.anim("roll", [[Math.PI * 2 * turns, durationMs, Ease.inOut]], () => { this.roll = 0; });
  }

  greet() {
    const t = now();
    this.anim("oy", [[-0.15, 200, Ease.out], [0.0, 300, Ease.back]]);
    this.eyeOverride = "happy";
    this.eyeOverrideUntil = t + 2.0;
    this.anim("drift", [[0.1, 200, Ease.out], [0, 500, Ease.inOut]]);
    setTimeout(() => {
      this.anim("sx", [[1.08, 100, Ease.out], [1.0, 260, Ease.back]]);
      this.anim("sy", [[0.92, 100, Ease.out], [1.0, 260, Ease.back]]);
      Sound.play("greet");
    }, 200);
    setTimeout(() => { this.blink(); }, 500);
    setTimeout(() => { this.blink(); }, 1500);
  }

  setPermanentEmote(emote: BotEmoteName | null) {
    this.permanentEmote = emote;
    this.permanentEye = emote ? CLOUD_EMOTE_EYE[emote] : null;
    if (this.permanentEye) {
      this.eyeOverride = this.permanentEye;
      this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    } else if (this.eyeOverrideUntil === Number.POSITIVE_INFINITY) {
      this.eyeOverride = null;
      this.eyeOverrideUntil = 0;
    }
  }

  triggerEmote(emote: BotEmoteName, duration = 1.8) {
    const t = now();
    this.eyeOverride = CLOUD_EMOTE_EYE[emote];
    this.eyeOverrideUntil = t + duration;

    switch (emote) {
      case "love":
        this.anim("blush", [
          [1, 300, Ease.out], [1, (duration - 0.6) * 1000, Ease.lin], [0, 300, Ease.inOut],
        ]);
        this.emit("sparkle", 4);
        this.anim("oy", [[-0.15, 160, Ease.out], [0, 300, Ease.back]]);
        break;
      case "surprised":
        this.anim("oy", [[-0.4, 140, Ease.out], [0, 380, Ease.back]]);
        this.anim("es", [[1.3, 120, Ease.out], [1, 500, Ease.inOut]]);
        break;
      case "proud":
        this.emit("sparkle", 5);
        this.anim("tilt", [
          [-0.15, 220, Ease.out], [-0.15, (duration - 0.5) * 1000, Ease.lin], [0, 280, Ease.inOut],
        ]);
        this.anim("blush", [
          [0.7, 250, Ease.out], [0.7, (duration - 0.5) * 1000, Ease.lin], [0, 300, Ease.inOut],
        ]);
        break;
      case "wink":
        this.anim("tilt", [
          [0.12, 160, Ease.out], [0.12, (duration - 0.4) * 1000, Ease.lin], [0, 240, Ease.inOut],
        ]);
        break;
      case "yawn":
        this.anim("sy", [[1.15, 500, Ease.inOut], [1, 500, Ease.inOut]]);
        this.anim("sx", [[0.9, 500, Ease.inOut], [1, 500, Ease.inOut]]);
        setTimeout(() => { this.eyeOverride = "closed"; this.emit("z", 2); }, 700);
        break;
      case "happy":
        this.anim("blush", [[0.6, 200, Ease.out], [0, 600, Ease.inOut]]);
        this.emit("sparkle", 3);
        break;
      case "annoyed":
        this.eyeOverride = "closed";
        this.eyeOverrideUntil = t + 0.8;
        setTimeout(() => Sound.play("annoyed"), 60);
        break;
    }
  }

  emit(type: CloudParticle["type"], count: number) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        type,
        x: (Math.random() - 0.5) * 0.8,
        y: -0.8 - Math.random() * 0.3,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -(0.4 + Math.random() * 0.3),
        age: -i * 0.12,
        life: 1.5 + Math.random() * 0.5,
        rot: Math.random() * Math.PI * 2,
        size: 0.12 + Math.random() * 0.06,
      });
    }
  }

  animateMorph(target: number, durationMs?: number) {
    const dur = durationMs ?? (target > 0.5 ? 550 : 650);
    this.anim("morph", [[target, dur, Ease.inOut]]);
  }

  resetMorph() {
    this.tweens.delete("morph");
    this.locks.delete("morph");
    this.morph = 0;
  }

  // ── Tweens ──────────────────────────────────────────────────────────────────

  anim(prop: CloudPropKey, keys: CloudTweenKey[], onComplete?: () => void) {
    this.tweens.set(prop, {
      prop, keys, index: 0, from: this[prop], startMs: performance.now(), onComplete,
    });
    this.locks.add(prop);
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  update(dt: number) {
    const n = now();
    const nowMs = performance.now();

    for (const tw of [...this.tweens.values()]) {
      const k = tw.keys[tw.index];
      const p = Math.min(1, Math.max(0, (nowMs - tw.startMs) / k[1]));
      this[tw.prop] = tw.from + (k[0] - tw.from) * k[2](p);
      if (p >= 1) {
        tw.from = k[0];
        tw.index += 1;
        tw.startMs = nowMs;
        if (tw.index >= tw.keys.length) {
          this.tweens.delete(tw.prop);
          this.locks.delete(tw.prop);
          tw.onComplete?.();
        }
      }
    }

    const t = n - this.t0;
    let ty = this.lookX * 0.5;
    let tp = this.lookY * 0.4;

    if (this.cfg.look) {
      ty = ty * 0.3 + this.cfg.look[0] * 0.5;
      tp = tp * 0.25 + this.cfg.look[1] * 0.5;
    }
    if (this.cfg.drifts) {
      ty = Math.sin(t * 1.8) * 0.4;
      tp = Math.cos(t * 1.3) * 0.2 - 0.05;
    }
    if (this.state === "sleeping") { ty = 0; tp = -0.1; }
    if (this.state === "dizzy") { ty = Math.sin(t * 8) * 0.2; }

    this.tgYaw = ty;
    this.tgPitch = tp;
    this.tgTilt = this.cfg.tilt;

    // Gentle drift animation
    if (this.cfg.drifts || this.state === "idle") {
      this.tgDrift = Math.sin(t * 0.6) * 0.15 + Math.cos(t * 0.9) * 0.08;
    }

    // Breathing
    const kGen = 1 - Math.pow(0.001, dt);
    if (this.cfg.breathes) {
      const amp = 0.04;
      this.tgSy = 1 + Math.sin(t * 1.5) * amp;
      this.tgSx = 1 - Math.sin(t * 1.5) * amp * 0.4;
    } else {
      this.tgSy = 1;
      this.tgSx = 1;
    }

    // Puff animation
    if (n > this.nextPuff && this.state === "idle") {
      this.nextPuff = n + 4 + Math.random() * 6;
      this.puff();
    }

    const kLook = 1 - Math.pow(0.003, dt);
    if (!this.locks.has("yaw")) this.yaw += (this.tgYaw - this.yaw) * kLook;
    if (!this.locks.has("pitch")) this.pitch += (this.tgPitch - this.pitch) * kLook;
    if (!this.locks.has("tilt")) this.tilt += (this.tgTilt - this.tilt) * kGen;
    if (!this.locks.has("sy")) this.sy += (this.tgSy - this.sy) * kGen;
    if (!this.locks.has("sx")) this.sx += (this.tgSx - this.sx) * kGen;
    if (!this.locks.has("es")) this.es += (this.tgEs - this.es) * kGen;
    if (!this.locks.has("drift")) this.drift += (this.tgDrift - this.drift) * (1 - Math.pow(0.0005, dt));
    if (!this.locks.has("puffPhase")) this.puffPhase += (this.tgPuff - this.puffPhase) * (1 - Math.pow(0.005, dt));

    this.col = mix3(this.col, this.colT, 1 - Math.pow(0.002, dt));

    if (n > this.nextBlink) {
      if (this.state !== "sleeping" && this.state !== "dizzy") {
        this.blink();
        if (Math.random() < 0.15) setTimeout(() => this.blink(), 200);
      }
      this.nextBlink = n + 3 + Math.random() * 4;
    }

    if (this.eyeOverride && n > this.eyeOverrideUntil) {
      this.eyeOverride = this.permanentEye;
      if (this.permanentEye) this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    }

    if (n - this.nextAmbient > 2) {
      this.nextAmbient = n + 2 + Math.random() * 3;
      if (this.cfg.zz) this.emit("z", 1);
      if (this.cfg.sparkle && Math.random() < 0.3) this.emit("sparkle", 1);
    }

    for (const p of this.particles) p.age += dt;
    this.particles = this.particles.filter((p) => p.age < p.life);

    this.lastTime = n;
  }

  // ── Draw ────────────────────────────────────────────────────────────────────

  /**
   * Draws the cloud into a canvas of `w`×`h` CSS pixels.
   */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const R = w * 0.35;
    const cx = w / 2 + this.ox * R + this.drift * R * 0.5;
    const cy = h / 2 + this.oy * R;

    ctx.save();
    ctx.translate(cx, cy);
    if (this.tilt !== 0) ctx.rotate(this.tilt);
    ctx.scale(this.sx, this.sy);

    const body = this.cloudPath(R);
    this.drawCloudBody(ctx, body, R);
    this.drawCloudEyes(ctx, body, R);
    this.drawCloudBlush(ctx, body, R);

    ctx.restore();

    if (this.badge && this.badgeS > 0.01 && this.morph < 0.25) {
      this.drawBadge(ctx, this.badge, R, cx, cy);
    }
    this.drawParticles(ctx, R, cx, cy);
  }

  private cloudPath(R: number): Path2D {
    const p = new Path2D();
    const centers = [
      { x: 0, y: 0, r: R * 0.9 },
      { x: -R * 0.6, y: -R * 0.2, r: R * 0.65 },
      { x: R * 0.6, y: -R * 0.2, r: R * 0.65 },
      { x: -R * 0.3, y: R * 0.3, r: R * 0.55 },
      { x: R * 0.3, y: R * 0.3, r: R * 0.55 },
      { x: 0, y: R * 0.5, r: R * 0.5 },
      { x: -R * 0.8, y: R * 0.1, r: R * 0.45 },
      { x: R * 0.8, y: R * 0.1, r: R * 0.45 },
    ];

    // Build the cloud shape as union of circles
    for (const c of centers) {
      p.moveTo(c.x + c.r, c.y);
      p.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    }
    p.closePath();
    return p;
  }

  private drawCloudBody(ctx: CanvasRenderingContext2D, body: Path2D, R: number) {
    if (this.bodyColor) {
      // Integration pill: flat color
      ctx.fillStyle = rgba(this.bodyColor, 1);
      ctx.fill(body);
      return;
    }

    // Cloud gradient - soft white to light blue
    const g = ctx.createLinearGradient(-R, -R, R, R * 1.5);
    g.addColorStop(0, rgba(CLOUD_WHITE, 1));
    g.addColorStop(0.4, rgba(CLOUD_WHITE, 0.98));
    g.addColorStop(0.7, rgba(CLOUD_LIGHT, 0.9));
    g.addColorStop(1, rgba(CLOUD_SHADOW, 0.6));
    ctx.fillStyle = g;
    ctx.fill(body);

    // Tint overlay
    const effectiveTint = this.tint * (1 - this.morph);
    if (effectiveTint > 0.01) {
      const tg = ctx.createLinearGradient(0, R, 0, -R);
      tg.addColorStop(0, rgba(this.col, 0.6 * effectiveTint));
      tg.addColorStop(1, rgba(this.col, 0));
      ctx.fillStyle = tg;
      ctx.fill(body);
    }

    // Subtle shadow for depth
    const sh = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.3);
    sh.addColorStop(0, "rgba(0,0,0,0)");
    sh.addColorStop(0.5, "rgba(0,0,0,0)");
    sh.addColorStop(1, "rgba(0,0,0,0.15)");
    ctx.fillStyle = sh;
    ctx.fill(body);

    // Highlight on top
    const hl = ctx.createRadialGradient(-R * 0.3, -R * 0.4, 0, -R * 0.3, -R * 0.4, R * 0.5);
    hl.addColorStop(0, "rgba(255,255,255,0.6)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.fill(body);
  }

  private drawCloudEyes(ctx: CanvasRenderingContext2D, body: Path2D, R: number) {
    let shape: CloudEyeShape = this.eyeOverride ?? this.cfg.eye;
    
    if (this.morph > 0.5) {
      shape = "happy";
    }

    ctx.save();
    ctx.clip(body);
    const ink = "rgba(30,30,50,0.9)";
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;

    for (const sd of [-1, 1]) {
      const eyeYaw = sd * EYE_SP + this.yaw;
      let eyePitch = EYE_P + this.pitch + this.roll;
      eyePitch = (((eyePitch + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const cp = Math.cos(eyePitch);
      if (Math.cos(eyeYaw) * cp <= 0.04) continue;

      const ex = Math.sin(eyeYaw) * cp * R * 0.9;
      const ey = -Math.sin(eyePitch) * R * 0.7 + (this.morph > 0 ? R * 0.1 * this.morph : 0);
      const fx = lerp(Math.max(0.2, Math.cos(eyeYaw)), 1, this.morph * 0.5);
      const fy = lerp(Math.max(0.2, cp), 1, this.morph * 0.5);
      const ew = R * EYE_W * this.es;
      const eh = R * EYE_H * this.es;

      ctx.save();
      ctx.translate(ex, ey);
      ctx.scale(fx, fy);
      this.drawCloudEyeShape(ctx, shape, ew, eh, sd, ink);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawCloudEyeShape(
    ctx: CanvasRenderingContext2D, shape: CloudEyeShape,
    w: number, h: number, sd: number, ink: string,
  ) {
    const t = now();
    switch (shape) {
      case "wide":
        this.drawCloudEyeShape(ctx, "dot", w * 1.4, h * 1.3, sd, ink);
        break;
      case "dot":
        ctx.beginPath();
        ctx.arc(0, 0, w * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // Tiny sparkle
        if (this.cfg.sparkle) {
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.beginPath();
          ctx.arc(-w * 0.2, -h * 0.2, w * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case "happy":
        ctx.lineWidth = w * 0.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, h * 0.1, w * 0.85, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        break;
      case "closed":
        ctx.lineWidth = w * 0.35;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, -h * 0.05, w * 0.8, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
        break;
      case "sparkle": {
        ctx.lineWidth = w * 0.25;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#FFD700";
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2 + t * 2;
          const r1 = w * 0.2;
          const r2 = w * 0.7;
          ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
          ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
        }
        ctx.stroke();
        ctx.strokeStyle = ink;
        break;
      }
      case "sleepy":
        ctx.lineWidth = w * 0.3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, -h * 0.08, w * 0.75, Math.PI * 0.25, Math.PI * 0.75);
        ctx.stroke();
        break;
      case "wink":
        if (sd < 0) {
          ctx.beginPath();
          ctx.arc(0, 0, w * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.lineWidth = w * 0.4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.arc(0, h * 0.1, w * 0.85, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
        }
        break;
    }
  }

  private drawCloudBlush(ctx: CanvasRenderingContext2D, body: Path2D, R: number) {
    const blushVal = Math.max(this.blush, this.tint * 0.4) * (1 - this.morph);
    if (blushVal <= 0.01) return;

    ctx.save();
    ctx.clip(body);
    const yOffset = Math.sin(this.yaw) * R * 0.7;
    ctx.fillStyle = `rgba(255,140,180,${0.4 * blushVal})`;
    for (const sd of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sd * R * 0.55 + yOffset, R * 0.15, R * 0.15, R * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBadge(ctx: CanvasRenderingContext2D, badge: CloudBadge, R: number, cx: number, cy: number) {
    const bs = this.badgeS;
    const bx = cx - R * 0.8;
    const by = cy - R * 0.8;
    const col = rgba(badge.color);

    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(bs, bs);

    if (badge.kind === "dots") {
      const phase = (now() * 2.2) % 1;
      const dotR = R * 0.2 * (1 + 0.3 * Math.sin(phase * Math.PI * 2));
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, dotR, 0, Math.PI * 2); ctx.fill();
    } else if (badge.kind === "arrow") {
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(0, 0, R * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2); ctx.fill();
      const a = R * 0.1;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = R * 0.05;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(0, a); ctx.lineTo(0, -a);
      ctx.moveTo(-a * 0.7, -a * 0.2); ctx.lineTo(0, -a); ctx.lineTo(a * 0.7, -a * 0.2);
      ctx.stroke();
    } else if (badge.kind === "bang" || badge.kind === "question") {
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(0, 0, R * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `800 ${R * 0.3}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(badge.kind === "bang" ? "!" : "?", 0, R * 0.01);
    } else if (badge.kind === "sparkle") {
      ctx.fillStyle = col;
      const t = now();
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 + t * 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle) * R * 0.22, Math.sin(angle) * R * 0.22);
        ctx.lineTo(Math.cos(angle + 0.3) * R * 0.12, Math.sin(angle + 0.3) * R * 0.12);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(0, 0, R * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, R: number, cx: number, cy: number) {
    for (const p of this.particles) {
      if (p.age <= 0) continue;
      const k = p.age / p.life;
      const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      const px = cx + (p.x + p.vx * p.age) * R * 1.4;
      const py = cy + (p.y + p.vy * p.age) * R * 1.4;
      const sz = R * p.size * (1 + k * 0.5);

      ctx.save();
      ctx.translate(px, py);
      ctx.globalAlpha = Math.min(1, Math.max(0, a));
      
      switch (p.type) {
        case "sparkle":
          ctx.rotate(p.rot + p.age * 3);
          ctx.fillStyle = "#FFD700";
          starPath(ctx, sz, sz * 0.4);
          ctx.fill();
          break;
        case "droplet":
          ctx.fillStyle = "#7CC7FF";
          ctx.beginPath();
          ctx.moveTo(0, -sz);
          ctx.quadraticCurveTo(sz * 0.7, sz * 0.3, 0, sz * 0.7);
          ctx.quadraticCurveTo(-sz * 0.7, sz * 0.3, 0, -sz);
          ctx.fill();
          break;
        case "puff":
          ctx.fillStyle = "rgba(200,210,240,0.7)";
          ctx.beginPath();
          ctx.arc(0, 0, sz, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "z":
          ctx.fillStyle = "rgba(180,190,220,0.8)";
          ctx.font = `600 ${sz * 1.6}px system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("z", 0, 0);
          break;
      }
      ctx.restore();
    }
  }
}

function starPath(ctx: CanvasRenderingContext2D, ro: number, ri: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}