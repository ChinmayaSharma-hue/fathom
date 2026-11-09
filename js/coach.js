// "Sonar": data-only feedback after each prompt, plus the player's long-run habits.
// Everything here is computed from the prompt's answer list, live rarity and the player's own
// history in localStorage; the only network call is the optional cross-prompt lookup for misses.
import { norm } from "./norms.js";
import { osaDistance, fuzzyLimit } from "./match.js";
import { oneIn } from "./rarity.js";

const KNOWN_PV = 1000;            // "well known": this many English Wikipedia readers a month
const HISTORY_KEY = "fathom.history";
const HISTORY_MAX = 400;

export const THEMES = {
  song_by: "Music", album_by: "Music", band_member: "Music",
  film_by_director: "Film & TV", film_starring: "Film & TV", series_on_network: "Film & TV",
  character_from: "Stories & characters", universe_character: "Stories & characters",
  book_by_author: "Books & art", painting_by: "Books & art", game_by_developer: "Video games",
  place_in_country: "Places", country_in_continent: "Places", moon_of: "Space",
  occupation_country: "People", occupation: "People", position_holder: "History & politics",
  team_player: "Sport", classes: "General knowledge", original: "Classics",
};

const TACTICS = {
  song_by: "Skip the greatest hits. Think album tracks, B-sides, early singles before they were famous, and late-career releases.",
  album_by: "The breakthrough and the best-seller are what everyone names. Debut albums, live albums and late-career records sit deeper.",
  band_member: "Everyone names the frontperson. Founding members who left early, drummers and later replacements score deep.",
  film_by_director: "Avoid the two or three films the director is famous for. Their early features and late, smaller films are deep water.",
  film_starring: "The star's big franchise roles come up first for everyone. Think supporting roles, early-career films and dramas.",
  series_on_network: "Long-running hits come first for everyone. Think short-lived series, older decades and niche genres on that channel.",
  character_from: "Protagonists are Shallows. Sidekicks, villains' henchmen and one-scene characters score deep.",
  universe_character: "Skip the headliners. Supporting heroes, minor villains and team members only fans remember score deep.",
  book_by_author: "Their famous novel is what everyone names. Short-story collections, early works and non-fiction score deep.",
  painting_by: "The one painting on every poster is common. Portraits, studies and works from a different period of their career go deeper.",
  game_by_developer: "Flagship franchises are common. Spin-offs, handheld titles and older arcade-era games score deep.",
  place_in_country: "The capital region and tourist spots come first. Go to the far north or south, border areas and smaller regions.",
  country_in_continent: "Big and newsworthy countries are common. Small states, island nations and landlocked countries are deep.",
  moon_of: "The big named moons are common. Small outer moons are deep.",
  occupation_country: "Household names are common. Think earlier centuries, pioneers, and people famous in a neighbouring field.",
  occupation: "Pick a corner: one country, one century or one sub-field, and name someone from it.",
  position_holder: "The first, the most recent and the most infamous holders are common. Mid-list holders from earlier eras are deep.",
  team_player: "Current stars and all-time legends are common. Squad players from past decades and short-stay signings are deep.",
  classes: "Pick a sub-group of the category (a region, an era or a sub-type) and name something from inside it.",
  original: "Pick a sub-group of the category (a region, an era or a sub-type) and name something from inside it.",
};

const pct = (x) => `${Math.round(x * 100)}%`;
const fmt = (n) => n.toLocaleString("en-US");
const list = (xs) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const end = (s) => (/[.!?]$/.test(s) ? s : s + ".");   // "Tie Me Down!" + "." -> no double stop
const deep = (t) => t === "rare" || t === "very_rare";

// ---------------------------------------------------------------- history

export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

export function recordHistory(entry) {
  const h = loadHistory();
  h.push(entry);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-HISTORY_MAX))); } catch { /* storage full or blocked */ }
  return h;
}

// ---------------------------------------------------------------- per-prompt analysis

// live: [{a, share, tier, points}] for every answer of the prompt
export function answerInsight(q, result, live, elapsedMs) {
  const out = [];
  if (result.timeout) {
    const known = live.filter((x) => x.a.pv >= KNOWN_PV).length;
    out.push(`Time ran out. ${fmt(known)} answers here have over ${fmt(KNOWN_PV)} English Wikipedia readers a month, so there was plenty to find.`);
    out.push("Habit to build: lock in something safe by about 15 seconds. A Shallows answer still beats zero.");
    return out;
  }
  const byShare = [...live].sort((x, y) => y.share - x.share);
  const rank = byShare.findIndex((x) => x.a.qid === result.qid) + 1;
  const me = live.find((x) => x.a.qid === result.qid);
  const what = me?.a.d ? `${result.name} (${me.a.d})` : result.name;
  out.push(`${what} is the #${fmt(rank)} most common of ${fmt(live.length)} valid answers: ${oneIn(result.share)} would say it.`);
  const knownDeep = live.filter((x) => deep(x.tier) && x.a.pv >= KNOWN_PV).sort((x, y) => y.a.pv - x.a.pv);
  if (!deep(result.tier) && knownDeep.length) {
    out.push(end(`${fmt(knownDeep.length)} answers score Midnight or Abyss and are still well known, for example ${list(knownDeep.slice(0, 3).map((x) => x.a.name))}`));
  } else if (deep(result.tier)) {
    out.push("A deep answer that's real and well documented: that's the skill this game rewards.");
  }
  if (elapsedMs != null) out.push(`You locked in after ${(elapsedMs / 1000).toFixed(1)} s.`);
  return out;
}

// Group answers by a facet (country or decade): where do most players fish, and where are the
// well-known deep answers? Returns null when no facet covers enough of the category.
const WORKS = new Set(["song_by", "album_by", "film_by_director", "film_starring", "series_on_network", "book_by_author",
  "painting_by", "game_by_developer"]);
const PEOPLE = new Set(["occupation_country", "occupation", "position_holder", "team_player", "band_member"]);
const NO_COUNTRY = new Set(["occupation_country", "place_in_country", "country_in_continent", "moon_of"]);
const THE = new Set(["United States", "Middle East", "Caribbean", "Balkans", "United Kingdom", "Netherlands", "Philippines", "Czech Republic", "Soviet Union",
  "Democratic Republic of the Congo", "Republic of the Congo", "Dominican Republic", "United Arab Emirates",
  "Central African Republic", "Bahamas", "Gambia", "Maldives", "Holy Roman Empire", "Ottoman Empire", "Russian Empire"]);
const country = (c) => (THE.has(c) ? `the ${c}` : c);

function facetsFor(q) {
  const out = [];
  if (!NO_COUNTRY.has(q.family)) {
    out.push({ key: "c", label: (v) => country(q.countries[v]), lead: "from" });
  }
  if (WORKS.has(q.family) || PEOPLE.has(q.family)) {
    out.push({ key: "y", label: (v) => `the ${v}s`, lead: PEOPLE.has(q.family) ? "people born in" : "from" });
  }
  return out;
}

// Group answers by a facet (country or decade): where do most players fish, and where are the
// well-known deep answers? Returns null when no facet is informative for this prompt.
export function facetInsight(q, live) {
  const known = live.filter((x) => x.a.pv >= 100);
  if (known.length < 8) return null;
  for (const f of facetsFor(q)) {
    const withF = known.filter((x) => x.a[f.key] != null);
    const distinct = new Set(withF.map((x) => x.a[f.key])).size;
    if (withF.length / known.length < 0.5 || distinct < 3 || distinct > 200 || distinct > 0.4 * withF.length) continue;
    const mass = new Map(), deepBy = new Map();
    let total = 0;
    for (const x of live) {
      const v = x.a[f.key];
      if (v == null) continue;
      mass.set(v, (mass.get(v) || 0) + x.share);
      total += x.share;
      if (deep(x.tier) && x.a.pv >= KNOWN_PV) {
        if (!deepBy.has(v)) deepBy.set(v, []);
        deepBy.get(v).push(x);
      }
    }
    if (!total) continue;
    const sorted = [...mass.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] / total > 0.75) continue;   // one value dominates: grouping teaches nothing
    const crowded = sorted.slice(0, 2);
    const crowdedVals = new Set(crowded.map(([v]) => v));
    const score = (xs) => xs.reduce((s, x) => s + Math.log10(x.a.pv + 1), 0);
    const deepWater = [...deepBy.entries()].filter(([v]) => !crowdedVals.has(v))
      .sort((a, b) => score(b[1]) - score(a[1])).slice(0, 3);
    if (!deepWater.length) continue;
    return [
      `Most players stay in familiar water: ${pct(crowded.reduce((s, [, m]) => s + m, 0) / total)} of expected answers are ${f.lead} ${list(crowded.map(([v]) => f.label(v)))}.`,
      "Well-known deep answers cluster elsewhere: " + deepWater.map(([v, xs]) =>
        `${f.label(v)} (${list(xs.sort((a, b) => b.a.pv - a.a.pv).slice(0, 2).map((x) => x.a.name))})`).join("; ") + ".",
    ];
  }
  return null;
}

export function tactic(q) {
  return TACTICS[q.family] || TACTICS.classes;
}

// Misses: near-spellings here, or the other prompt where the text is a valid answer.
export function missInsight(q, text, found, recorded = true) {
  const n = norm(text);
  if (found?.length) {
    const f = found[0];
    return `“${text}” isn't on this list, but ${f.name} is a valid answer to “${f.prompt}”.`;
  }
  if (n.length >= 3) {
    const maxD = (fuzzyLimit(n) ?? 0) + 1;   // one edit beyond what the matcher already forgives
    let best = null;
    for (const a of q.answers) {
      for (const acc of a.accept) {
        const d = osaDistance(n, acc, maxD);
        if (d <= maxD && (!best || d < best.d || (d === best.d && a.pv > best.a.pv))) best = { a, d };
      }
    }
    if (best) return `“${text}” is close to ${best.a.name}, but too far off to count: up to 1 typo is allowed for 5–8 letters and 2 beyond that.`;
  }
  return recorded ? `“${text}” isn't a known answer to this prompt. It's logged, so a valid answer we missed can be added.`
    : `“${text}” isn't a known answer to this prompt.`;
}

// ---------------------------------------------------------------- long-run habits

export function habitInsight(history) {
  const valid = history.filter((h) => h.t && h.t !== "miss");
  if (history.length < 5) return null;
  const lines = [];
  const recent = history.slice(-20);
  const shallow = recent.filter((h) => h.t === "common" || h.t === "familiar").length;
  const misses = recent.filter((h) => h.t === "miss").length;
  lines.push(`Your last ${recent.length} prompts: ${pct(shallow / recent.length)} landed in the Shallows or Reef, ${pct(recent.filter((h) => deep(h.t)).length / recent.length)} in Midnight or Abyss${misses ? `, ${misses} ran out of time` : ""}.`);
  const timed = valid.filter((h) => h.e != null);
  const avg = (xs) => xs.reduce((s, h) => s + h.e, 0) / xs.length / 1000;
  const fast = timed.filter((h) => h.t === "common" || h.t === "familiar"), slow = timed.filter((h) => deep(h.t));
  if (fast.length >= 3 && slow.length >= 3) {
    const a = avg(fast), b = avg(slow);
    if (b - a >= 2) lines.push(`Your deep answers took ${b.toFixed(0)} s on average, your shallow ones ${a.toFixed(0)} s. When you take a few extra seconds, you go deeper.`);
    else if (a - b >= 2) lines.push(`You find deep answers fast (${b.toFixed(0)} s) but spend ${a.toFixed(0)} s before settling for shallow ones. Trust your first unusual idea.`);
  }
  const byTheme = new Map();
  for (const h of history) {
    const th = THEMES[h.f] || "General knowledge";
    if (!byTheme.has(th)) byTheme.set(th, []);
    byTheme.get(th).push(h.p || 0);
  }
  const ranked = [...byTheme.entries()].filter(([, ps]) => ps.length >= 3)
    .map(([th, ps]) => [th, ps.reduce((s, p) => s + p, 0) / ps.length]).sort((a, b) => b[1] - a[1]);
  if (ranked.length >= 2) {
    const [best, worst] = [ranked[0], ranked[ranked.length - 1]];
    lines.push(`Strongest theme: ${best[0]} (${best[1].toFixed(0)} pts per prompt). Weakest: ${worst[0]} (${worst[1].toFixed(0)}). That's where practice will pay off most.`);
  }
  return lines;
}
