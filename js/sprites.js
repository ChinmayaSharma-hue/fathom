// Original pixel art for Fathom. Each sprite is rows of characters; "." is transparent and every
// other character is looked up in the sprite's palette. Sprites are rasterised once to small
// canvases (drawn scaled with smoothing off) and to data URLs for <img> icons in the UI.

export const TIER_COLORS = {
  common: "#f5d36b", familiar: "#48d597", uncommon: "#4aa3ff", rare: "#a67cff",
  very_rare: "#ff5d7a", too_obscure: "#b08968", miss: "#6b7a89",
};

const SPRITES = {
  // Shallows: starfish
  common: { pal: { a: "#f5d36b", b: "#c9962e", c: "#fff2b8" }, rows: [
    "....a....",
    "...aca...",
    "...aaa...",
    "aaaaaaaaa",
    ".aacabaa.",
    "..aaaaa..",
    "..aabaa..",
    ".aa...aa.",
    ".a.....a.",
  ] },
  // Reef: seahorse
  familiar: { pal: { a: "#48d597", b: "#1f8f5f", c: "#e9fff5" }, rows: [
    "..aaa...",
    ".aaca...",
    "aaaaabb.",
    "..aaa...",
    "...aab..",
    "..aaa...",
    ".aaab...",
    ".aaa....",
    "..aab...",
    "...aa...",
    "..a.a...",
    "...a....",
  ] },
  // Twilight: jellyfish
  uncommon: { pal: { a: "#4aa3ff", b: "#9fd0ff", c: "#1d5fa8" }, rows: [
    "..aaaaa..",
    ".abbaaaa.",
    "abbaaaaaa",
    "aaaaaaaaa",
    "cacacacac",
    ".a..a..a.",
    ".a..a..a.",
    "..a.a.a..",
    "..a..a.a.",
    ".a...a...",
  ] },
  // Midnight: squid
  rare: { pal: { a: "#a67cff", b: "#6a45c4", c: "#f1e9ff" }, rows: [
    "....a....",
    "...aaa...",
    "..aaaaa..",
    "..abaab..",
    "..aaaaa..",
    "..acaca..",
    "..aaaaa..",
    ".a.a.a.a.",
    ".a.a.a.a.",
    "a..a.a..a",
    "a..a.a..a",
    "...a.a...",
  ] },
  // Abyss: glowing gulper eel
  very_rare: { pal: { a: "#ff5d7a", b: "#a3243d", c: "#ffe3ea", d: "#ffd166" }, rows: [
    ".aaaa...........",
    "acaaaaa.........",
    "aaaaaaaaa.......",
    "abbbbaaaaaaaaa..",
    ".aaaa...aaaaaaa.",
    "..............ad",
  ] },
  // Too Obscure: message in a bottle
  too_obscure: { pal: { a: "#b08968", b: "#6e5136", c: "#f4e6c8" }, rows: [
    "..bb..",
    "..aa..",
    ".aaaa.",
    "aaaaaa",
    "acccca",
    "acbcca",
    "acccca",
    "aaaaaa",
    ".aaaa.",
  ] },
  // timeout: a lonely bubble
  miss: { pal: { a: "#9fb3c4", b: "#e8f4ff" }, rows: [
    ".aaa.",
    "ab..a",
    "a...a",
    "a...a",
    ".aaa.",
  ] },
  // the player: riveted bathysphere
  bell: { pal: { a: "#d98c3a", b: "#8a5420", c: "#2b3a46", d: "#9fe8ff", e: "#ffffff", f: "#ffd166", g: "#596b78" }, rows: [
    ".....gg.....",
    ".....gg.....",
    "...aaaaaa...",
    "..afaaaafa..",
    ".aaaccccaaa.",
    ".aacddddcaa.",
    "aaacdeddcaaa",
    "afacddddcafa",
    ".aacddddcaa.",
    ".aaaccccaaa.",
    "..abaaaaba..",
    "...bbbbbb...",
    "..bb....bb..",
  ] },
  raft: { pal: { a: "#5a3b22", b: "#8a5d36", c: "#2b2f36", d: "#d98c3a", e: "#c94f4f" }, rows: [
    ".......e......",
    ".......ee.....",
    ".......c......",
    "....cccccc....",
    "....cd..dc....",
    ".bbbbbbbbbbbb.",
    "aaaaaaaaaaaaaa",
  ] },
  lighthouse: { pal: { a: "#f2efe6", b: "#c94f4f", c: "#2b2f36", d: "#ffd166", e: "#4a4f57", f: "#6b7178" }, rows: [
    "....cc....",
    "...cccc...",
    "..cdddc...",
    "..cddddc..",
    "..cccccc..",
    "...aaaa...",
    "...bbbb...",
    "...aaaa...",
    "...aaaa...",
    "..bbbbbb..",
    "..aaaaaa..",
    "..aaaaaa..",
    "..bbbbbb..",
    ".aaaaaaaa.",
    ".aaaaaaaa.",
    ".bbbbbbbb.",
    "eeeeeeeeee",
    "effeeeffee",
    "eeeeeeeeeee",
  ] },
  fish: { pal: { a: "#0b2236" }, rows: [
    ".aaaa..a",
    "aaaaaaaa",
    ".aaaa..a",
  ] },
};

const cache = new Map();

export function spriteCanvas(name) {
  if (cache.has(name)) return cache.get(name);
  const s = SPRITES[name];
  const w = Math.max(...s.rows.map((r) => r.length)), h = s.rows.length;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  s.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === "." || ch === " ") return;
    g.fillStyle = s.pal[ch];
    g.fillRect(x, y, 1, 1);
  }));
  cache.set(name, c);
  return c;
}

// <img> icon for a tier (used in lists and the end screen)
const urls = new Map();
export function spriteURL(name, scale = 4) {
  const key = name + scale;
  if (urls.has(key)) return urls.get(key);
  const src = spriteCanvas(name);
  const c = document.createElement("canvas");
  c.width = src.width * scale; c.height = src.height * scale;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, c.width, c.height);
  const u = c.toDataURL();
  urls.set(key, u);
  return u;
}

export function tierIcon(tier, cls = "icon") {
  const img = new Image();
  img.src = spriteURL(SPRITES[tier] ? tier : "miss");
  img.className = cls;
  img.alt = "";
  return img;
}

// 3x5 pixel digits for the depth ruler
const DIGITS = {
  0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"], 4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "010", "010", "010"], 8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"], m: ["000", "000", "111", "111", "101"], ",": ["000", "000", "000", "010", "100"],
};

export function pixelText(g, text, x, y, color) {
  g.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const d = DIGITS[ch];
    if (d) d.forEach((row, ry) => [...row].forEach((b, rx) => { if (b === "1") g.fillRect(cx + rx, y + ry, 1, 1); }));
    cx += 4;
  }
  return cx - x;
}
