// Port of norm() / singular() / keys() from pipeline/norms.py. Must stay byte-for-byte equivalent:
// game/tests/js/parity.test.mjs checks it against the Python output for the whole fixture sample.

export function norm(s) {
  // Python: unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
  s = s.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
  s = s.replace(/\([^\n]*?\)/g, " "); // Python "." excludes only \n (JS "." also excludes \r)
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\bst\b/g, "saint");
  return s.replaceAll("colour", "color").replaceAll("aluminium", "aluminum").replaceAll("sulphur", "sulfur");
}

export function singular(s) {
  if (s.endsWith("ies") && s.length > 4) return s.slice(0, -3) + "y";
  if (s.endsWith("s") && !s.endsWith("ss") && s.length > 3) return s.slice(0, -1);
  return s;
}

// Python str.split() with no argument: split on runs of whitespace, drop empty pieces.
const words = (s) => s.split(/\s+/).filter(Boolean);

export function keys(s) {
  const n = norm(s);
  return new Set([n, singular(n), words(n).map(singular).join(" "), n.replaceAll(" ", "")]);
}
