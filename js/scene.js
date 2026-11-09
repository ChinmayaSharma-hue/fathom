// The living backdrop: a low-resolution canvas (scaled up with crisp pixels) showing sky, sea and the
// player's bathysphere on its cable. The game drives it through a few promise-returning animations.
import { spriteCanvas, pixelText, TIER_COLORS } from "./sprites.js";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const WATER = [[0, [47, 134, 179]], [60, [31, 106, 152]], [200, [22, 78, 122]], [1000, [12, 47, 82]],
  [4000, [6, 23, 46]], [7000, [2, 8, 18]], [20000, [1, 3, 8]]];
const SKY_TOP = [111, 170, 214], SKY_HORIZON = [248, 219, 176];
const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  outBack: (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
};
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)));
const rgb = (c, a = 1) => (a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function waterAt(d) {
  for (let i = 1; i < WATER.length; i++) {
    if (d <= WATER[i][0]) return mix(WATER[i - 1][1], WATER[i][1], (d - WATER[i - 1][0]) / (WATER[i][0] - WATER[i - 1][0]));
  }
  return WATER[WATER.length - 1][1];
}

export class Scene {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext("2d");
    this.t = 0;
    this.mode = "home";
    this.cam = 0;              // depth (m) shown at the anchor line
    this.bellDepth = 0;        // m
    this.tweens = [];
    this.bubbles = []; this.pings = []; this.drops = []; this.placed = []; this.swimmers = [];
    this.shake = 0; this.alarm = false;
    this.resize();
    addEventListener("resize", () => this.resize());
    this.snow = Array.from({ length: 70 }, () => this.newSnow(true));
    this.fish = Array.from({ length: 14 }, () => this.newFish(true));
    this.glows = Array.from({ length: 40 }, () => ({ x: Math.random(), d: 900 + Math.random() * 9000, p: Math.random() * 6.28,
      col: Math.random() < 0.6 ? [127, 240, 255] : [255, 120, 170] }));
    this.clouds = Array.from({ length: 6 }, (_, i) => ({ x: Math.random(), y: 0.25 + Math.random() * 0.6, w: 18 + Math.random() * 26, s: 0.4 + Math.random() * 0.6, seed: i }));
    this.setMode("home", false);
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.step(dt, now); this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    this.px = innerWidth < 640 ? 2 : 3;
    this.W = Math.ceil(innerWidth / this.px);
    this.H = Math.ceil(innerHeight / this.px);
    this.c.width = this.W; this.c.height = this.H;
    this.k = (this.H * 0.55) / 160;          // pixels per metre: 160 m fills about half the screen
    this.anchor = Math.round(this.H * (innerWidth < 640 ? 0.22 : 0.36));  // where the bell hangs while diving (above the prompt panel on phones)
    this.bellX = Math.round(this.W * (innerWidth < 640 ? 0.18 : 0.3));
    if (this.mode === "home") this.cam = this.homeCam();
  }

  homeCam() { return (this.anchor - this.H * (innerWidth < 640 ? 0.5 : 0.62)) / this.k; }   // where the horizon sits on the title screen
  y(d) { return this.anchor + (d - this.cam) * this.k; }

  // ------------------------------------------------------------ animation plumbing
  tween(obj, key, to, dur, fn = ease.inOut) {
    if (REDUCED) dur = Math.min(dur, 1);
    return new Promise((resolve) => {
      this.tweens = this.tweens.filter((t) => !(t.obj === obj && t.key === key));
      this.tweens.push({ obj, key, from: obj[key], to, start: performance.now(), dur, fn, resolve });
    });
  }
  wait(ms) { return new Promise((r) => setTimeout(r, REDUCED ? 0 : ms)); }

  step(dt, now) {
    this.t += dt;
    this.tweens = this.tweens.filter((tw) => {
      const p = Math.min(1, (now - tw.start) / tw.dur);
      tw.obj[tw.key] = lerp(tw.from, tw.to, tw.fn(p));
      if (p >= 1) { tw.resolve(); return false; }
      return true;
    });
    if (this.mode === "dive" && !this.camLocked) this.cam = lerp(this.cam, this.bellDepth, Math.min(1, dt * 6));
    this.shake *= Math.pow(0.02, dt);
    const by = this.y(this.bellDepth);
    if (this.mode === "dive" && Math.random() < dt * (REDUCED ? 0 : 2.5)) this.bubble(this.bellX + 6, by - 4, 1);
    for (const b of this.bubbles) { b.y -= b.v * dt; b.x += Math.sin(this.t * 3 + b.p) * dt * 6; b.life -= dt; }
    this.bubbles = this.bubbles.filter((b) => b.life > 0 && b.y > this.y(0));
    for (const p of this.pings) p.r += dt * 70;
    this.pings = this.pings.filter((p) => p.r < p.max);
    for (const d of this.drops) { d.vy += 140 * dt; d.x += d.vx * dt; d.y += d.vy * dt; }
    this.drops = this.drops.filter((d) => d.y < this.y(0) + 2);
    for (const s of this.snow) { s.d += s.v * dt; s.x += Math.sin(this.t + s.p) * 0.002 * dt; }
    this.snow = this.snow.map((s) => (Math.abs(this.y(s.d) - this.H / 2) > this.H ? this.newSnow(false) : s));
    for (const f of this.fish) f.x += f.vx * dt / this.W;
    this.fish = this.fish.map((f) => (f.x < -0.1 || f.x > 1.1 || Math.abs(this.y(f.d) - this.H / 2) > this.H * 1.5 ? this.newFish(false) : f));
    for (const c of this.clouds) { c.x += c.s * dt * 0.004; if (c.x > 1.2) c.x = -0.3; }
  }

  newSnow(anywhere) {
    const top = this.cam + (0 - this.anchor) / this.k, bot = this.cam + (this.H - this.anchor) / this.k;
    return { x: Math.random(), d: Math.max(2, anywhere ? lerp(top, bot, Math.random()) : top - Math.random() * 30), v: 1 + Math.random() * 3, p: Math.random() * 6 };
  }
  newFish(anywhere) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const view = this.cam + (Math.random() * this.H - this.anchor) / this.k;
    return { x: anywhere ? Math.random() : dir > 0 ? -0.05 : 1.05, d: Math.min(900, Math.max(6, view + (Math.random() - 0.5) * 60)),
      vx: dir * (6 + Math.random() * 10) };
  }
  bubble(x, y, n) {
    for (let i = 0; i < n; i++) this.bubbles.push({ x: x + (Math.random() - 0.5) * 6, y, v: 10 + Math.random() * 18, p: Math.random() * 6, life: 2 + Math.random() * 2, r: Math.random() < 0.3 ? 2 : 1 });
  }

  // ------------------------------------------------------------ public animations
  setMode(mode, animate = true) {
    this.mode = mode;
    if (mode === "home") {
      this.placed = []; this.swimmers = [];
      this.tween(this, "bellDepth", 2.5, animate ? 900 : 1);
      return this.tween(this, "cam", this.homeCam(), animate ? 1200 : 1);
    }
    return Promise.resolve();
  }

  async dropIn() {   // from the raft into the water
    this.mode = "dive"; this.camLocked = true;
    this.splash();
    this.tween(this, "cam", 12, 1300);
    await this.tween(this, "bellDepth", 12, 1300, ease.outBack);
    this.camLocked = false;
  }

  splash() {
    const y = this.y(0);
    for (let i = 0; i < 18; i++) this.drops.push({ x: this.bellX + 6 + (Math.random() - 0.5) * 10, y: y - 1, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 50 });
    this.bubble(this.bellX + 6, y + 6, 14);
  }

  async descendTo(m, dur) {
    m = Math.max(12, m);
    const dist = m - this.bellDepth;
    if (dist <= 0.5) return;
    this.bubble(this.bellX + 6, this.y(this.bellDepth) - 4, 10);
    const trail = setInterval(() => this.bubble(this.bellX + 6, this.anchor - 2, 3), 70);
    await this.tween(this, "bellDepth", m, dur ?? Math.min(2200, 700 + dist * 1.2), ease.inOut);
    clearInterval(trail);
  }

  ping(color = "#ffd166") {
    this.pings.push({ x: this.bellX + 6, d: this.bellDepth, r: 4, max: 90, col: hexRgb(color) });
    if (!REDUCED) setTimeout(() => this.pings.push({ x: this.bellX + 6, d: this.bellDepth, r: 4, max: 70, col: hexRgb(color) }), 180);
  }

  // resume a dive: bell straight to depth, earlier rounds' creatures at theirs
  jumpTo(m) { this.mode = "dive"; this.bellDepth = Math.max(12, m); this.cam = this.bellDepth; }
  place(tier, d) { this.placed.push({ tier, d, x: this.bellX + 34 + (this.placed.length % 2) * 6, born: Math.random() * 6 }); }

  jolt() { this.shake = REDUCED ? 0 : 5; this.bubble(this.bellX + 6, this.y(this.bellDepth), 4); }
  setAlarm(on) { this.alarm = on; }

  // a creature swims in beside the bell and stays at that depth as a marker of the round
  async arrive(tier) {
    const s = { tier, d: this.bellDepth, x: this.W + 20, born: this.t };
    this.swimmers.push(s);
    const side = this.bellX + 34 + (this.placed.length % 2) * 6;
    await this.tween(s, "x", side, 900, ease.out);
    this.swimmers = this.swimmers.filter((x) => x !== s);
    this.placed.push(s);
    if (tier !== "miss") this.ping(TIER_COLORS[tier]);
  }

  // ------------------------------------------------------------ drawing
  draw() {
    const { g, W, H } = this;
    g.imageSmoothingEnabled = false;
    const surf = Math.round(this.y(0));
    // sky + water, one row at a time
    for (let y = 0; y < H; y++) {
      if (y < surf) {
        const t = Math.max(0, Math.min(1, (surf - y) / (H * 0.7)));
        g.fillStyle = rgb(mix(SKY_HORIZON, SKY_TOP, Math.sqrt(t)));
      } else {
        g.fillStyle = rgb(waterAt(this.cam + (y - this.anchor) / this.k));
      }
      g.fillRect(0, y, W, 1);
    }
    if (surf > -40) this.drawSurfaceWorld(surf);
    this.drawRays(surf);
    // marine snow
    for (const s of this.snow) {
      const y = this.y(s.d);
      if (y < surf + 2 || y > H) continue;
      g.fillStyle = `rgba(220,240,255,${0.12 + 0.25 * Math.min(1, s.d / 800)})`;
      g.fillRect(Math.round(s.x * W), Math.round(y), 1, 1);
    }
    // deep-sea glow
    for (const gl of this.glows) {
      const y = this.y(gl.d);
      if (y < surf || y > H) continue;
      const a = (0.35 + 0.35 * Math.sin(this.t * 1.7 + gl.p)) * Math.min(1, (gl.d - 600) / 1500);
      g.fillStyle = rgb(gl.col, Math.max(0, a));
      g.fillRect(Math.round(gl.x * W), Math.round(y), 1, 1);
      g.fillStyle = rgb(gl.col, Math.max(0, a * 0.25));
      g.fillRect(Math.round(gl.x * W) - 1, Math.round(y) - 1, 3, 3);
    }
    // fish
    const fishImg = spriteCanvas("fish");
    for (const f of this.fish) {
      const y = Math.round(this.y(f.d) + Math.sin(this.t * 2 + f.d) * 1.5);
      if (y < surf + 3 || y > H) continue;
      g.save(); g.globalAlpha = Math.max(0.15, 0.7 - f.d / 1400);
      g.translate(Math.round(f.x * W), y);
      if (f.vx < 0) g.scale(-1, 1);
      g.drawImage(fishImg, -4, -1);
      g.restore();
    }
    this.drawCable(surf);
    for (const s of [...this.placed, ...this.swimmers]) this.drawCreature(s);
    this.drawBell();
    // bubbles
    for (const b of this.bubbles) {
      if (b.y < surf) continue;
      g.fillStyle = "rgba(210,240,255,0.55)";
      if (b.r > 1) { g.fillRect(Math.round(b.x) - 1, Math.round(b.y), 3, 1); g.fillRect(Math.round(b.x), Math.round(b.y) - 1, 1, 3); }
      else g.fillRect(Math.round(b.x), Math.round(b.y), 1, 1);
    }
    // sonar pings
    for (const p of this.pings) {
      const a = 1 - p.r / p.max;
      g.strokeStyle = rgb(p.col, a * 0.8);
      g.lineWidth = 1;
      g.beginPath(); g.arc(p.x, this.y(p.d), p.r, 0, Math.PI * 2); g.stroke();
    }
    for (const d of this.drops) { g.fillStyle = "#d9f3ff"; g.fillRect(Math.round(d.x), Math.round(d.y), 1, 1); }
    this.drawRuler(surf);
    if (this.alarm) {
      const a = 0.18 + 0.14 * Math.sin(this.t * 9);
      const grd = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      grd.addColorStop(0, "rgba(255,60,80,0)"); grd.addColorStop(1, `rgba(255,60,80,${a})`);
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
    }
  }

  drawSurfaceWorld(surf) {
    const { g, W } = this;
    // sun low on the horizon
    const sx = Math.round(W * 0.82), sy = surf - 22;
    for (let r = 9; r > 0; r -= 3) {
      g.fillStyle = r === 9 ? "rgba(255,214,140,0.35)" : r === 6 ? "rgba(255,200,120,0.6)" : "#ffd88a";
      g.beginPath(); g.arc(sx, sy, r * 1.6, 0, Math.PI * 2); g.fill();
    }
    // blocky clouds
    for (const c of this.clouds) {
      const cx = Math.round(c.x * W), cy = Math.round(surf - c.y * this.H * 0.55);
      const w = Math.round(c.w);
      g.fillStyle = "#fdf6ea";
      g.fillRect(cx, cy, w, 4); g.fillRect(cx + 4, cy - 3, w - 10, 3); g.fillRect(cx + 9, cy - 6, Math.round(w / 3), 3);
      g.fillStyle = "#e9d9c4"; g.fillRect(cx + 2, cy + 3, w - 4, 1);
    }
    // lighthouse on its rock, with a sweeping beam
    const lh = spriteCanvas("lighthouse");
    const lx = Math.round(W * (innerWidth < 640 ? 0.78 : 0.12)), ly = surf - lh.height * 2 + 3;
    const beam = Math.sin(this.t * 0.9);
    g.save();
    g.globalAlpha = 0.18 + 0.12 * Math.abs(beam);
    g.fillStyle = "#fff3c4";
    g.beginPath();
    const bx = lx + 9, by = ly + 5;
    g.moveTo(bx, by); g.lineTo(bx + beam * 120, by - 10); g.lineTo(bx + beam * 120, by + 6); g.closePath(); g.fill();
    g.restore();
    g.drawImage(lh, lx, ly, lh.width * 2, lh.height * 2);
    // waves
    for (let x = 0; x < W; x++) {
      const h = Math.round(Math.sin(x * 0.09 + this.t * 1.6) * 1.2 + Math.sin(x * 0.031 - this.t * 0.8) * 1.3);
      g.fillStyle = rgb(waterAt(0));
      if (h < 0) g.fillRect(x, surf + h, 1, -h);
      g.fillStyle = "rgba(220,245,255,0.75)";
      g.fillRect(x, surf + Math.min(0, h) - (h < -1 ? 0 : 0), 1, 1);
    }
    // raft with winch at the top of the cable
    const raft = spriteCanvas("raft");
    const bob = Math.round(Math.sin(this.t * 1.6 + this.bellX * 0.09) * 1);
    g.drawImage(raft, this.bellX + 6 - raft.width, surf - raft.height * 2 + 4 + bob, raft.width * 2, raft.height * 2);
  }

  drawRays(surf) {
    const { g, W, H } = this;
    const fade = Math.max(0, 1 - this.cam / 250);
    if (fade <= 0 || surf > H) return;
    g.save();
    for (let i = 0; i < 5; i++) {
      const x0 = ((i * 0.23 + 0.08) * W + Math.sin(this.t * 0.3 + i) * 10);
      g.globalAlpha = (0.05 + 0.03 * Math.sin(this.t * 0.7 + i * 2)) * fade;
      g.fillStyle = "#e6fbff";
      g.beginPath();
      g.moveTo(x0, Math.max(0, surf)); g.lineTo(x0 + 10, Math.max(0, surf));
      g.lineTo(x0 + 40, H); g.lineTo(x0 + 18, H); g.closePath(); g.fill();
    }
    g.restore();
  }

  drawCable(surf) {
    const { g } = this;
    const top = Math.max(0, surf - 2), bot = Math.round(this.y(this.bellDepth)) - 12;
    if (bot <= top) return;
    g.fillStyle = "rgba(30,36,44,0.85)";
    const sway = (y) => Math.round(Math.sin(this.t * 1.2 + y * 0.02) * (y - top) / 160);
    for (let y = top; y < bot; y++) g.fillRect(this.bellX + 5 + sway(y) + this.shakeX(), y, 1, 1);
  }

  shakeX() { return Math.round(Math.sin(this.t * 60) * this.shake); }

  drawBell() {
    const { g } = this;
    const img = spriteCanvas("bell");
    const x = this.bellX - 6 + this.shakeX(), y = Math.round(this.y(this.bellDepth)) - 13 + Math.round(Math.sin(this.t * 2) * 1);
    if (this.bellDepth > 120) {   // headlamp cone in the dark
      g.save();
      g.globalAlpha = Math.min(0.22, (this.bellDepth - 120) / 1500);
      g.fillStyle = "#fff1b0";
      g.beginPath(); g.moveTo(x + 12, y + 13); g.lineTo(x - 30, y + 90); g.lineTo(x + 54, y + 90); g.closePath(); g.fill();
      g.restore();
    }
    g.drawImage(img, x, y, img.width * 2, img.height * 2);
  }

  drawCreature(s) {
    const { g } = this;
    const img = spriteCanvas(s.tier);
    const y = Math.round(this.y(s.d) + Math.sin(this.t * 2.2 + s.born) * 2) - img.height;
    if (y < -30 || y > this.H + 30) return;
    if (s.tier === "rare" || s.tier === "very_rare" || s.tier === "uncommon") {
      const col = hexRgb(TIER_COLORS[s.tier]);
      const grd = g.createRadialGradient(s.x + img.width, y + img.height, 1, s.x + img.width, y + img.height, 22);
      grd.addColorStop(0, rgb(col, 0.35 + 0.15 * Math.sin(this.t * 3 + s.born))); grd.addColorStop(1, rgb(col, 0));
      g.fillStyle = grd; g.fillRect(s.x - 22, y - 22, img.width * 2 + 44, img.height * 2 + 44);
    }
    g.drawImage(img, Math.round(s.x), y, img.width * 2, img.height * 2);
  }

  drawRuler(surf) {
    const { g, W, H } = this;
    const steps = [10, 25, 50, 100, 250, 500, 1000, 2500];
    const step = steps.find((s) => s * this.k >= 18) || 2500;
    const top = this.cam - this.anchor / this.k, bot = this.cam + (H - this.anchor) / this.k;
    g.fillStyle = "rgba(220,240,255,0.25)";
    g.fillRect(W - 3, Math.max(0, surf), 1, H);
    for (let m = Math.max(0, Math.ceil(top / step) * step); m <= bot; m += step) {
      const y = Math.round(this.y(m));
      const major = (m / step) % 4 === 0;
      g.fillStyle = `rgba(220,240,255,${major ? 0.6 : 0.3})`;
      g.fillRect(W - (major ? 7 : 5), y, major ? 5 : 3, 1);
      if (major) {
        const label = `${m.toLocaleString("en-US")}m`;
        pixelText(g, label, W - 9 - label.length * 4, y - 2, "rgba(220,240,255,0.55)");
      }
    }
  }
}
