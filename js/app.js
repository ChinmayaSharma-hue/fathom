import { Matcher } from "./match.js";
import { dailyPrompts, localDate } from "./daily.js";
import { liveRarity, score, oneIn, PRIOR_STRENGTH } from "./rarity.js";
import { answerInsight, facetInsight, tactic, missInsight, habitInsight, loadHistory, recordHistory } from "./coach.js";
import { api } from "./api.js";
import { Scene } from "./scene.js";
import { tierIcon, spriteCanvas, pixelText, TIER_COLORS } from "./sprites.js";

const ROUND_SECONDS = 25;
const COUNTDOWN_MS = 3000;               // "flooding the tanks": the clock starts after this
const METERS_PER_POINT = 10;             // 7 Abyss answers = 7,000 m
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const EMOJI = { common: "🟨", familiar: "🟩", uncommon: "🟦", rare: "🟪", very_rare: "🟥", too_obscure: "🟫", miss: "⬛" };
const ZONES = [[200, "Sunlit zone"], [1000, "Twilight zone"], [4000, "Midnight zone"], [6000, "Abyssal zone"], [Infinity, "Hadal zone"]];
const DIFF_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: play on without saving */ } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, REDUCED ? 0 : ms));
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const fmtM = (m) => `${fmt(m)}m`;
const zoneOf = (m) => ZONES.find(([max]) => m < max)[1];

let INDEX, TIERS, scene;
const questions = new Map();             // id -> {q, matcher}
let game = null;                         // current run: {mode, date, ids?, saved?, results[], i}
let round = null;                        // current prompt
const total = () => game.results.reduce((s, r) => s + (r?.points || 0), 0);
const tierInfo = (id) => TIERS.find((t) => t.id === id) || { id: "miss", name: "Missed", points: 0 };
const wiki = (title) => INDEX.wiki_prefix + title;
const todaysIds = (date) => dailyPrompts(date, INDEX.questions, INDEX.daily_mix);
const dailyKey = (date) => `fathom.daily.${date}`;

// ---------------------------------------------------------------- setup

function playerId() {
  let id = store.get("fathom.player");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    store.set("fathom.player", id);
  }
  return id;
}

async function loadQuestion(id) {
  if (!questions.has(id)) {
    const r = await fetch(`data/q/${id}.json?v=${INDEX.version}`);
    if (!r.ok) throw new Error(`could not load prompt ${id}`);
    const q = await r.json();
    questions.set(id, { q, matcher: new Matcher(q.answers) });
  }
  return questions.get(id);
}

function show(screen) {
  for (const s of ["home", "round", "reveal", "end"]) $(s).hidden = s !== screen && !(screen === "reveal" && s === "round");
  $("hud").hidden = screen === "home" || screen === "end";
  if (screen !== "reveal") window.scrollTo(0, 0);
}

// count a number up in an element
function animateNumber(node, from, to, dur, f = fmt) {
  if (REDUCED || dur <= 0 || from === to) { node.textContent = f(to); return Promise.resolve(); }
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      node.textContent = f(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
}

function bump(node) { node.classList.remove("bump"); void node.offsetWidth; node.classList.add("bump"); }

// ---------------------------------------------------------------- home

function bankInfo() {
  const n = INDEX.questions.length;
  const days = INDEX.daily_mix
    ? Math.min(...Object.entries(INDEX.daily_mix).map(([d, k]) => INDEX.questions.filter((q) => (q.bucket || q.difficulty) === d).length / k))
    : n / 7;
  const weeks = Math.floor((0.9 * days) / 7);
  return `${fmt(n)} prompts${weeks >= 2 ? ` · no daily repeats for at least ${weeks} weeks` : ""}`;
}

function dailySummary(date) {
  const ids = todaysIds(date);
  const saved = store.get(dailyKey(date));
  const done = saved ? ids.filter((id) => saved.rounds[id]?.result).length : 0;
  const pts = saved ? ids.reduce((s, id) => s + (saved.rounds[id]?.result?.points || 0), 0) : 0;
  return { ids, done, pts };
}

function refreshHome() {
  const date = localDate();
  const { ids, done, pts } = dailySummary(date);
  $("btn-daily").textContent = done === ids.length ? "See today's dive" : done ? `Continue the dive (${done}/${ids.length})` : "Drop the bell";
  $("daily-status").textContent = done === ids.length
    ? `Today's dive: ${pts} points, ${fmtM(pts * METERS_PER_POINT)}. New prompts at midnight.`
    : `${date} · the same seven prompts for everyone today`;
  $("bank-info").textContent = bankInfo();
  $("net").textContent = api.online ? "" : api.disabled
    ? "Static edition: rarity comes from the built-in estimates and answers aren't recorded."
    : "Offline: answers are scored with the built-in rarity estimates and not recorded.";
  scene.setAlarm(false);
  scene.setMode("home");
  show("home");
}

// ---------------------------------------------------------------- runs

function setupHud() {
  const dots = $("hud-dots");
  if (game.mode === "daily") {
    dots.hidden = false;
    dots.replaceChildren(...game.ids.map(() => el("i")));
  } else dots.hidden = true;
  $("hud-score").textContent = fmt(total());
  $("hud-depth").textContent = fmtM(total() * METERS_PER_POINT);
}

function paintDots() {
  if (game.mode !== "daily") return;
  [...$("hud-dots").children].forEach((d, i) => {
    const r = game.results[i];
    d.className = r ? "done" : i === game.i ? "now" : "";
    d.style.background = r ? TIER_COLORS[r.timeout ? "miss" : r.tier] : "";
  });
}

async function startDaily() {
  const date = localDate();
  const ids = todaysIds(date);
  const saved = store.get(dailyKey(date)) || { ids, rounds: {} };
  store.set(dailyKey(date), saved);
  game = { mode: "daily", date, ids, saved, results: ids.map((id) => saved.rounds[id]?.result || null), i: 0 };
  ids.forEach((id) => loadQuestion(id).catch(() => {}));   // warm the offline cache for today's prompts
  await enterWater();
  nextDaily();
}

// put the bell where this run left it (resuming), or drop it in from the raft
async function enterWater() {
  setupHud();
  show("round");
  $("round").hidden = true;
  let depth = 0;
  game.results.forEach((r) => {
    if (!r) return;
    depth += r.points * METERS_PER_POINT;
    scene.place(r.timeout ? "miss" : r.tier, Math.max(12, depth));
  });
  if (depth > 0) scene.jumpTo(depth);
  else await scene.dropIn();
}

function nextDaily() {
  const i = game.results.findIndex((r) => !r);
  if (i < 0) return showEnd();
  game.i = i;
  playRound(game.ids[i]);
}

let practiceDiff = store.get("fathom.practiceDiff") || "";

async function startPractice() {
  game = { mode: "practice", date: localDate(), results: [], recent: [], i: 0, diff: practiceDiff };
  await enterWater();
  nextPractice();
}

function nextPractice() {
  const pool = INDEX.questions.filter((q) => !game.diff || q.difficulty === game.diff || !q.difficulty)
    .map((q) => q.id).filter((id) => !game.recent.includes(id));
  const id = pool[Math.floor(Math.random() * pool.length)];
  game.recent = [...game.recent, id].slice(-Math.min(50, Math.floor(pool.length / 2)));
  game.i = game.results.length;
  game.results.push(null);
  playRound(id);
}

// ---------------------------------------------------------------- a round

async function playRound(id) {
  let loaded;
  try { loaded = await loadQuestion(id); }
  catch {
    if (game.mode === "practice") { game.results.pop(); return nextPractice(); }   // offline and not cached: try another
    alert("Couldn't load today's prompt. Check your connection and try again."); return refreshHome();
  }
  const { q, matcher } = loaded;
  let started = Date.now() + COUNTDOWN_MS;
  if (game.mode === "daily") {   // the clock survives reloads, so refreshing can't buy extra time
    const rec = game.saved.rounds[id] || (game.saved.rounds[id] = {});
    rec.startedAt ??= started;
    started = rec.startedAt;
    store.set(dailyKey(game.date), game.saved);
  }
  round = { q, matcher, started, deadline: started + ROUND_SECONDS * 1000, stats: null, locked: false, tries: 0, misses: [] };
  api.stats(q.id).then((s) => { if (round?.q === q) round.stats = s; });

  const diff = DIFF_LABEL[q.difficulty];
  $("r-label").textContent = (game.mode === "daily" ? `Prompt ${game.i + 1} of ${game.ids.length}` : `Practice #${game.i + 1}`) + (diff ? ` · ${diff}` : "");
  $("hud-count").textContent = game.mode === "daily" ? `prompt ${game.i + 1} of ${game.ids.length}` : `practice #${game.i + 1}`;
  $("r-prompt").textContent = q.prompt;
  $("r-feedback").textContent = "";
  $("r-feedback").className = "feedback";
  $("r-form").className = "";
  $("air-cells").replaceChildren(...Array.from({ length: ROUND_SECONDS }, () => el("i")));
  const input = $("r-input");
  input.value = ""; input.disabled = false;
  paintDots();
  show("round");
  const plate = document.querySelector(".prompt-plate");
  plate.classList.remove("away");
  plate.style.animation = "none"; void plate.offsetWidth; plate.style.animation = "";
  input.focus();
  tick();
  round.timer = setInterval(tick, 100);
}

function tick() {
  const now = Date.now();
  const cd = $("r-countdown");
  if (now < round.started) {
    cd.hidden = false;
    cd.innerHTML = `flooding the tanks · the clock starts in <b>${Math.ceil((round.started - now) / 1000)}</b>`;
  } else cd.hidden = true;
  const left = Math.max(0, round.deadline - Math.max(now, round.started)) / 1000;
  const cells = $("air-cells").children;
  const gone = ROUND_SECONDS - Math.ceil(left);
  for (let i = 0; i < cells.length; i++) cells[i].className = i >= cells.length - gone ? "gone" : "";
  $("air-num").textContent = Math.ceil(left);
  const low = left <= 5 && now >= round.started;
  document.querySelector(".air").classList.toggle("low", low);
  scene.setAlarm(low && !round.locked);
  if (left <= 0 && !round.locked) finishRound(null);
}

function onSubmit(ev) {
  ev.preventDefault();
  if (!round || round.locked) return;
  const input = $("r-input");
  const text = input.value.trim();
  if (!text) return;
  if (Date.now() < round.started) {
    $("r-feedback").textContent = "hold on, the tanks are still flooding";
    return;
  }
  const hit = round.matcher.match(text);
  const body = { player: playerId(), date: game.date, question: round.q.id, mode: game.mode, text };
  if (!hit) {
    round.tries++;
    if (!round.misses.includes(text)) round.misses.push(text);
    api.submit(body);   // recorded so the admin view can spot valid answers the bank is missing
    const form = $("r-form"), fb = $("r-feedback");
    form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");
    fb.className = "feedback"; void fb.offsetWidth; fb.className = "feedback glitch";
    fb.textContent = `“${text}” isn't on the list`;
    scene.jolt();
    input.select();
    navigator.vibrate?.(60);
    return;
  }
  finishRound({ answer: round.q.answers[hit.index], text, method: hit.method }, body);
}

async function finishRound(hit, body) {
  round.locked = true;
  clearInterval(round.timer);
  scene.setAlarm(false);
  const { q } = round;
  $("r-input").disabled = true;
  const before = total();
  let result, stats = round.stats;
  const elapsed = hit ? Date.now() - round.started : null;
  if (!hit) {
    result = { timeout: true, points: 0, tier: "miss" };
    scene.jolt();
    stats ??= await api.stats(q.id);
  } else {
    $("r-form").classList.add("lock");
    $("r-feedback").className = "feedback ok";
    $("r-feedback").textContent = hit.method === "fuzzy" ? `close enough: ${hit.answer.name}` : "locked in";
    scene.ping("#ffb347");
    // Server scores on the rarity as it stood before this answer and stores it; offline we use the bank.
    const [res] = await Promise.all([api.submit(body), sleep(550)]);
    let answer = hit.answer, sc;
    if (res?.valid) {
      answer = q.answers.find((a) => a.qid === res.qid) || answer;
      sc = { share: res.share, tier: res.tier, points: res.points };
      stats = res.stats;
    } else {
      sc = score(answer, stats || { n: 0, counts: {} }, TIERS, stats?.S ?? PRIOR_STRENGTH);
    }
    result = { qid: answer.qid, name: answer.name, wikipedia: answer.wikipedia, text: hit.text, ...sc, recorded: !!res?.valid };
  }
  result.prompt = q.prompt;
  result.elapsed = elapsed;
  result.misses = round.misses;
  game.results[game.i] = result;
  if (game.mode === "daily") {
    game.saved.rounds[q.id].result = result;
    store.set(dailyKey(game.date), game.saved);
  }
  recordHistory({ d: game.date, m: game.mode, q: q.id, f: q.family || "original", diff: q.difficulty || null,
                  t: result.timeout ? "miss" : result.tier, p: result.points, e: elapsed, x: round.misses.length });
  paintDots();
  await lockInSequence(result, before, total());
  showReveal(q, result, stats);
}

// the payoff: stamp, descent with ticking counters, creature arrival
async function lockInSequence(result, beforePts, afterPts) {
  const stamp = $("stamp");
  const tier = result.timeout ? "miss" : result.tier;
  const color = TIER_COLORS[tier];
  stamp.replaceChildren(
    el("div", { className: "pts", textContent: result.timeout ? "OUT OF AIR" : `+${result.points}` }),
    el("div", { className: "tier", textContent: result.timeout ? "no answer locked in" : tierInfo(tier).name }));
  stamp.style.color = color;
  stamp.className = "stamp"; stamp.hidden = false; void stamp.offsetWidth; stamp.className = "stamp in";
  const fromM = beforePts * METERS_PER_POINT, toM = afterPts * METERS_PER_POINT;
  const dur = Math.min(2200, 700 + (toM - fromM) * 1.2);
  document.querySelector(".prompt-plate").classList.add("away");   // clear the stage for the descent
  await sleep(350);
  if (toM > fromM) {
    animateNumber($("hud-score"), beforePts, afterPts, dur);
    animateNumber($("hud-depth"), fromM, toM, dur, fmtM);
    await scene.descendTo(Math.max(12, toM), dur);
    bump($("hud-score")); bump($("hud-depth"));
  } else await sleep(500);
  await scene.arrive(tier);
  await sleep(250);
  stamp.className = "stamp out";
  await sleep(380);
  stamp.hidden = true;
}

// ---------------------------------------------------------------- reveal

function shareText(share) { return share >= 0.01 ? `${Math.round(share * 100)}%` : oneIn(share).replace(/^about /, "").replace(/ players$/, ""); }

function answerItem(a, live, mine) {
  const nm = el("span", { className: "nm" }, el("a", { href: wiki(a.wikipedia), target: "_blank", rel: "noopener", textContent: a.name }));
  if (a.d) nm.append(el("span", { className: "desc", textContent: a.d }));
  const li = el("li", { className: mine ? "mine" : "", title: tierInfo(live.tier).name }, tierIcon(live.tier), nm,
    el("span", { className: `sh c-${live.tier}`, textContent: shareText(live.share) }));
  return li;
}

function sonarBlock(title, lines, cls = "") {
  return el("div", { className: `block ${cls}` }, el("h4", { textContent: title }), ...lines.map((t) => el("p", { textContent: t })));
}

function renderSonar(q, result, live) {
  const box = $("v-sonar");
  box.replaceChildren(sonarBlock("Your answer", answerInsight(q, result, live, result.elapsed)));
  if (result.misses?.length) {
    const lines = result.misses.slice(0, 4).map((t) => el("p", { textContent: missInsight(q, t, null, api.online) }));
    box.append(el("div", { className: "block" }, el("h4", { textContent: "Your misses" }), ...lines));
    result.misses.slice(0, 4).forEach((t, i) => api.lookup(t, q.id).then((found) => {
      if (found.length) lines[i].textContent = missInsight(q, t, found, api.online);
    }));
  }
  const facet = facetInsight(q, live);
  if (facet) box.append(sonarBlock("Where the deep water is", facet));
  box.append(sonarBlock("Tactic for this kind of prompt", [tactic(q)], "tip"));
  const habits = habitInsight(loadHistory());
  if (habits) box.append(sonarBlock("Your habits", habits));
}

function showReveal(q, result, stats) {
  const n = stats?.n || 0, counts = stats?.counts || {}, S = stats?.S ?? PRIOR_STRENGTH;
  const live = q.answers.map((a) => ({ a, ...liveRarity(a, counts[a.qid] || 0, n, TIERS, S) }));
  const common = [...live].sort((x, y) => y.share - x.share).slice(0, 5);
  const rare = live.filter((x) => x.tier === "rare" || x.tier === "very_rare").sort((x, y) => y.a.pv - x.a.pv).slice(0, 3);

  const card = $("v-card");
  const tier = result.timeout ? "miss" : result.tier;
  card.replaceChildren(tierIcon(tier), el("span", { className: "q", textContent: q.prompt }));
  if (result.timeout) {
    card.append(el("span", { className: "ans", textContent: "Out of air" }), el("span", { className: "pts c-miss", textContent: "+0" }),
      el("span", { className: "sub", textContent: "No answer locked in. Here's what was down there." }));
  } else {
    card.append(el("a", { className: "ans", href: wiki(result.wikipedia), target: "_blank", rel: "noopener", textContent: result.name }),
      el("span", { className: `pts c-${tier}`, textContent: `+${result.points}` }),
      el("span", { className: "sub", innerHTML: "" }));
    card.lastChild.append(el("span", { className: `c-${tier}`, textContent: tierInfo(tier).name }), ` · ${oneIn(result.share)} would say it`);
  }
  card.append(el("span", { className: "sub", textContent: n ? `Rarity blends the model with ${fmt(n)} player answer${n === 1 ? "" : "s"}.`
    : api.online ? "No player answers yet: rarity is the model's estimate." : "Offline: rarity is the model's estimate." }));

  renderSonar(q, result, live);
  $("v-common").replaceChildren(...common.map((x) => answerItem(x.a, x, x.a.qid === result.qid)));
  $("v-rare").replaceChildren(...rare.map((x) => answerItem(x.a, x, x.a.qid === result.qid)));
  const last = game.mode === "daily" && game.results.every(Boolean);
  $("v-next").textContent = last ? "Surface and see your dive" : "Next prompt";
  $("v-end").hidden = game.mode !== "practice";
  const sheet = $("reveal");
  sheet.hidden = false; sheet.scrollTop = 0;
  sheet.style.animation = "none"; void sheet.offsetWidth; sheet.style.animation = "";
  document.querySelector(".prompt-plate").parentElement.hidden = true;
  $("v-next").focus({ preventScroll: true });
}

// ---------------------------------------------------------------- end

function logbook() {
  const days = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith("fathom.daily.")) continue;
    const date = k.slice(13);
    const saved = store.get(k);
    const ids = saved?.ids || [];
    if (ids.length && ids.every((id) => saved.rounds[id]?.result)) days.push({ date, pts: ids.reduce((s, id) => s + saved.rounds[id].result.points, 0) });
  }
  const set = new Set(days.map((d) => d.date));
  let streak = 0;
  for (let d = new Date(); set.has(localDate(d)); d.setDate(d.getDate() - 1)) streak++;
  const avg = days.length ? days.reduce((s, d) => s + d.pts, 0) / days.length : 0;
  const best = days.reduce((m, d) => Math.max(m, d.pts), 0);
  return { streak, played: days.length, avg, best };
}

function drawProfile(results) {
  const cv = $("e-chart");
  const W = 300, H = 120, top = 10, bottom = 108, left = 26, right = 292;
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  const maxM = 1000;                                      // one prompt can sink at most 100 pts = 1,000 m
  const yOf = (m) => top + (bottom - top) * Math.min(1, m / maxM);
  const n = results.length;
  const xOf = (i) => Math.round(left + (right - left) * ((i + 0.5) / n));
  const base = () => {
    for (let y = 0; y < H; y++) {
      const t = y / H;
      g.fillStyle = `rgb(${Math.round(18 - 14 * t)},${Math.round(64 - 52 * t)},${Math.round(98 - 76 * t)})`;
      g.fillRect(0, y, W, 1);
    }
    for (const m of [0, 250, 500, 750, 1000]) {
      const y = Math.round(yOf(m));
      g.fillStyle = "rgba(220,240,255,0.18)";
      for (let x = left; x < right; x += 4) g.fillRect(x, y, 2, 1);
      pixelText(g, `${m}`, 2, y - 2, "rgba(220,240,255,0.5)");
    }
    results.forEach((_, i) => pixelText(g, `${i + 1}`, xOf(i) - 1, H - 7, "rgba(220,240,255,0.5)"));
  };
  const drawCol = (i, p) => {
    const r = results[i];
    const tier = r.timeout ? "miss" : r.tier;
    const m = r.points * METERS_PER_POINT;
    const y = Math.round(yOf(m * p));
    g.fillStyle = TIER_COLORS[tier];
    g.globalAlpha = 0.6;
    g.fillRect(xOf(i), top, 1, Math.max(0, y - top));
    g.globalAlpha = 1;
    if (p >= 1) {
      const img = spriteCanvas(tier);
      g.drawImage(img, xOf(i) - Math.floor(img.width / 2), y - Math.floor(img.height / 2));
    }
  };
  base();
  if (REDUCED) { results.forEach((_, i) => drawCol(i, 1)); return; }
  let i = 0, start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / 380);
    base();
    for (let j = 0; j < i; j++) drawCol(j, 1);
    drawCol(i, 1 - (1 - p) ** 3);
    if (p >= 1) { i++; start = now; }
    if (i < n) requestAnimationFrame(step); else { base(); results.forEach((_, j) => drawCol(j, 1)); }
  };
  requestAnimationFrame(step);
}

function showEnd() {
  const results = game.results.filter(Boolean);
  const pts = total(), m = pts * METERS_PER_POINT;
  scene.setAlarm(false);
  $("e-title").textContent = game.mode === "daily" ? `Dive complete · ${game.date}` : `Practice · ${results.length} prompt${results.length === 1 ? "" : "s"}`;
  $("e-depth").textContent = `-${fmtM(m)}`;
  $("e-zone").textContent = zoneOf(m);
  show("end");
  $("end").scrollTop = 0;
  $("e-score").textContent = "0";
  setTimeout(() => animateNumber($("e-score"), 0, pts, 1400), 300);
  drawProfile(results);
  const line = results.map((r) => EMOJI[r.timeout ? "miss" : r.tier] || EMOJI.miss).join("");
  const text = game.mode === "daily"
    ? `Fathom ${game.date}\n${line}\n${pts} pts · ${fmtM(m)} · ${zoneOf(m)}\n${location.origin}${location.pathname}`
    : `Fathom practice\n${line}\n${pts} pts · ${fmtM(m)}`;
  $("e-share").textContent = text;
  $("e-copy").onclick = () => copy(text);
  $("e-copied").textContent = "";
  $("e-list").replaceChildren(...results.map((r, i) => {
    const tier = r.timeout ? "miss" : r.tier;
    return el("li", {},
      el("span", { className: "n", textContent: i + 1 }), tierIcon(tier),
      el("span", { className: "p", textContent: r.prompt }),
      r.timeout ? el("span", { className: "a c-miss", textContent: "out of air" })
        : el("a", { className: "a", href: wiki(r.wikipedia), target: "_blank", rel: "noopener", textContent: r.name, style: "color:inherit;text-decoration:none" }),
      el("span", { className: `pts c-${tier}`, textContent: r.points }));
  }));
  const habits = habitInsight(loadHistory());
  $("e-habits").hidden = !habits;
  if (habits) $("e-habits").replaceChildren(sonarBlock("Your dive log", habits));
  const lb = logbook();
  $("e-log").innerHTML = `Streak <b>${lb.streak}</b> · Dives <b>${lb.played}</b> · Avg <b>${fmt(lb.avg)}</b> · Best <b>${fmt(lb.best)}</b>`;
}

async function copy(text) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; }
  catch {
    const ta = el("textarea", { value: text }); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.append(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
  }
  $("e-copied").textContent = ok ? "Copied. Paste it anywhere: it gives nothing away." : "Couldn't reach the clipboard: select the text above and copy it.";
}

// ---------------------------------------------------------------- wiring

async function init() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  scene = new Scene($("scene"));
  [INDEX] = await Promise.all([fetch("data/index.json").then((r) => r.json()), api.check()]);
  TIERS = INDEX.tiers;
  $("legend").replaceChildren(...TIERS.map((t) => el("span", {}, tierIcon(t.id), `${t.name} ${t.points}`)));
  $("btn-daily").onclick = startDaily;
  $("btn-practice").onclick = startPractice;
  $("e-practice").onclick = startPractice;
  $("e-home").onclick = refreshHome;
  $("r-form").addEventListener("submit", onSubmit);
  $("r-form").addEventListener("animationend", (e) => e.currentTarget.classList.remove("shake"));
  $("v-next").onclick = () => {
    $("reveal").hidden = true;
    if (game.mode === "daily") nextDaily(); else nextPractice();
  };
  $("v-end").onclick = () => { $("reveal").hidden = true; showEnd(); };
  const segs = document.querySelectorAll(".seg button");
  const paintSeg = () => segs.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.diff === practiceDiff)));
  segs.forEach((b) => { b.onclick = () => { practiceDiff = b.dataset.diff; store.set("fathom.practiceDiff", practiceDiff); paintSeg(); }; });
  paintSeg();
  document.querySelector(".seg").hidden = !INDEX.daily_mix;
  window.addEventListener("online", () => api.check());
  refreshHome();
}

init().catch((e) => {
  document.querySelector("main").replaceChildren(el("p", { className: "center", textContent: `Fathom couldn't start: ${e.message}` }));
});
