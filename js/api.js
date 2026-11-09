// Backend calls. Every call has a short timeout; on failure the game falls back to local scoring.
const setting = document.querySelector('meta[name="fathom-api"]')?.content ?? "";
const BASE = setting === "off" ? null : setting.replace(/\/$/, "");

async function call(path, opts = {}, timeout = 3500) {
  if (BASE === null) throw new Error("backend disabled");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(BASE + path, { ...opts, signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  online: false,
  disabled: BASE === null,
  async check() {
    try { await call("/api/health", {}, 2500); this.online = true; } catch { this.online = false; }
    return this.online;
  },
  async stats(questionId) {
    if (!this.online) return null;
    try { return await call(`/api/stats/${encodeURIComponent(questionId)}`); } catch { return null; }
  },
  async lookup(text, questionId) {
    if (!this.online) return [];
    try {
      const r = await call(`/api/lookup?text=${encodeURIComponent(text)}&q=${encodeURIComponent(questionId)}`, {}, 2500);
      return r.found || [];
    } catch { return []; }
  },
  // -> server response, or null if unreachable / rejected
  async submit(body) {
    if (!this.online) return null;
    try {
      return await call("/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      if (e.name === "AbortError" || e instanceof TypeError) this.online = false; // network gone: stop waiting on it
      return null;
    }
  },
};
