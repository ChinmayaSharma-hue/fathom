// Answer matching; twin of Matcher in game/core.py.
import { norm, keys } from "./norms.js";

// Damerau-Levenshtein, optimal-string-alignment variant, with early exit above maxD.
export function osaDistance(a, b, maxD) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > maxD) return maxD + 1;
  let prev2 = null, prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1).fill(0);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxD) return maxD + 1;
    prev2 = prev; prev = cur;
  }
  return prev[lb];
}

export function fuzzyLimit(n) {
  if (n.length < 5) return null;
  return n.length <= 8 ? 1 : 2;
}

export class Matcher {
  // answers: in bank order (share descending)
  constructor(answers) {
    this.answers = answers;
    this.index = new Map();
    answers.forEach((a, i) => {
      for (let k of a.accept) {
        k = k.trim(); // 19 bank spellings carry a trailing space ("lawry ")
        if (!k) continue;
        if (!this.index.has(k)) this.index.set(k, []);
        this.index.get(k).push(i);
      }
    });
  }

  // -> {index, method: "exact" | "fuzzy"} or null
  match(text) {
    text = text || "";
    const ks = [...keys(text)].filter(Boolean);
    let best = null;
    for (const k of ks) {
      for (const i of this.index.get(k) || []) {
        if (best === null || this.answers[i].share > this.answers[best].share ||
            (this.answers[i].share === this.answers[best].share && i < best)) best = i;
      }
    }
    if (best !== null) return { index: best, method: "exact" };
    const maxD = fuzzyLimit(norm(text));
    if (maxD === null) return null;
    let found = null;
    for (let i = 0; i < this.answers.length; i++) {
      const hit = this.answers[i].accept.some((acc) => (acc = acc.trim()) && ks.some((k) => osaDistance(k, acc, maxD) <= maxD));
      if (hit) {
        if (found !== null) return null; // ambiguous typo: reject
        found = i;
      }
    }
    return found === null ? null : { index: found, method: "fuzzy" };
  }
}
