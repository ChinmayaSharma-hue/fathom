// Live rarity and scoring; twin of posterior / tier_of / live_rarity / score in game/core.py.
export const PRIOR_STRENGTH = 20;

export const posterior = (shareModel, count, n, S = PRIOR_STRENGTH) => (count + shareModel * S) / (n + S);

export function tierOf(share, tiers) {
  const graded = tiers.filter((t) => "min_share" in t);
  return graded.find((t) => share >= t.min_share) || graded[graded.length - 1];
}

export function liveRarity(answer, count, n, tiers, S = PRIOR_STRENGTH) {
  const share = posterior(answer.share, count, n, S);
  const t = answer.tier === "too_obscure" || n === 0 ? tiers.find((x) => x.id === answer.tier) : tierOf(share, tiers);
  return { share, tier: t.id, points: t.points };
}

// snapshot: {n, counts: {qid: count}} frozen before the submission
export const score = (answer, snapshot, tiers, S = PRIOR_STRENGTH) =>
  liveRarity(answer, snapshot.counts[answer.qid] || 0, snapshot.n, tiers, S);

// "about 1 in 40 players"
export function oneIn(share) {
  if (!(share > 0) || share < 1e-5) return "fewer than 1 in 100,000 players";
  const n = 1 / share;
  if (n < 1.5) return "nearly every player";
  const r = n < 20 ? Math.round(n) : n < 200 ? Math.round(n / 5) * 5 : n < 2000 ? Math.round(n / 50) * 50 : Math.round(n / 500) * 500;
  return `about 1 in ${r.toLocaleString("en-US")} players`;
}
