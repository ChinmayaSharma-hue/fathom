// Daily prompt schedule; twin of daily_prompts() in game/core.py (see its docstring for the method).
export const PROMPTS_PER_DAY = 7;
export const EPOCH = "2026-01-01";
export const DEFAULT_MIX = { easy: 3, medium: 2, hard: 2 };
const CYCLE_GROUPS = 10;
const DAY_MS = 86400000;

export function fnv1a(s) {
  const bytes = new TextEncoder().encode(s);
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

const toMs = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function bucketCycles(ids, family, bucket, upto) {
  const n = ids.length;
  const perms = [];
  let prev = null;
  for (let c = 0; c <= upto; c++) {
    const h = {};
    for (const i of ids) h[i] = fnv1a(`${bucket}|${c}|${i}`);
    const byFam = new Map();
    for (const i of ids) { if (!byFam.has(family[i])) byFam.set(family[i], []); byFam.get(family[i]).push(i); }
    const spread = {};
    for (const members of byFam.values()) {
      members.sort((a, b) => h[a] - h[b] || cmp(a, b));
      members.forEach((i, r) => { spread[i] = (r + 0.5) / members.length; });
    }
    const group = {};
    if (prev === null) for (const i of ids) group[i] = 0;
    else prev.forEach((i, pos) => { group[i] = Math.floor((pos * CYCLE_GROUPS) / n); });
    prev = [...ids].sort((a, b) => group[a] - group[b] || spread[a] - spread[b] || h[a] - h[b] || cmp(a, b));
    perms.push(prev);
  }
  return perms;
}

const cache = new Map();

// questions: [{id, difficulty?, family?}] or plain ids
export function dailyPrompts(date, questions, mix = null, epoch = EPOCH) {
  let qs = questions.map((q) => (typeof q === "string" ? { id: q } : q))
    .map((q) => ({ ...q, difficulty: q.bucket || q.difficulty }));   // daily bucket, if the bank has one
  if (qs.every((q) => q.difficulty)) mix = mix || DEFAULT_MIX;
  else { mix = { all: PROMPTS_PER_DAY }; qs = qs.map((q) => ({ ...q, difficulty: "all" })); }
  const day = Math.max(0, Math.round((toMs(date) - toMs(epoch)) / DAY_MS));
  const out = [];
  for (const [bucket, k] of Object.entries(mix)) {
    const inB = qs.filter((q) => q.difficulty === bucket);
    const ids = [...new Set(inB.map((q) => q.id))].sort();
    if (ids.length < k) throw new Error(`bucket ${bucket} has ${ids.length} prompts, needs at least ${k}`);
    const family = Object.fromEntries(inB.map((q) => [q.id, q.family || ""]));
    const first = day * k, last = day * k + k - 1;
    const key = bucket + "\u0000" + ids.join("\u0001");
    let perms = cache.get(key) || [];
    if (perms.length <= Math.floor(last / ids.length)) {
      perms = bucketCycles(ids, family, bucket, Math.floor(last / ids.length));
      cache.set(key, perms);
    }
    for (let p = first; p <= last; p++) out.push(perms[Math.floor(p / ids.length)][p % ids.length]);
  }
  return out;
}

// Local calendar date of the player, YYYY-MM-DD: everyone gets a new dive at their own midnight.
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
