// Hebrew text for a terminal: cleanup, mark order, wrapping, and the three ways
// a line of Hebrew is ordered for the surface that draws it. Pure functions.

// Combining marks: te'amim (cantillation) and nikkud (vowels, dagesh, shin dots).
const MARK = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/;
const TEAMIM = /[\u0591-\u05AF\u05BD]/g;
const NIKKUD = /[\u05B0-\u05BC\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
const HEB = /[\u05D0-\u05EA]/;
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<" };

// Sefaria text to plain text: no HTML, entities, or {ס}/{פ} section markers.
export function cleanText(s: string) {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&thinsp;|&ensp;|&emsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&[a-z]+;/g, "")
    .replace(/\{[\u05E1\u05E4]\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Hebrew for display: te'amim and paseq dropped, nikkud kept or dropped, marks
// in the order fonts expect.
export function cleanHe(s: string, withNikkud: boolean) {
  let t = cleanText(s).replace(TEAMIM, "").replace(/\s*\u05C0\s*/g, " ");
  if (!withNikkud) t = t.replace(NIKKUD, "");
  return markOrder(t);
}

// Unicode's canonical order puts a letter's vowel before its dagesh (בְּ is
// bet, sheva, dagesh), but terminals don't reorder marks the way text shapers
// do, and fonts place a dagesh or shin dot right only when it comes first.
// So each letter's marks go: shin/sin dot, dagesh, rafe, then the rest.
const MARK_RANK: Record<string, number> = { "\u05C1": 0, "\u05C2": 0, "\u05BC": 1, "\u05BF": 2 };
const rank = (m: string) => MARK_RANK[m] ?? 3;
export function markOrder(t: string) {
  return t.replace(/([\u05D0-\u05EA\uFB1D-\uFB4F])([\u0591-\u05C7]+)/g, (_, base: string, marks: string) =>
    base + [...marks].map((m, i) => [m, i] as const)
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([m]) => m).join(""));
}

// A number in Hebrew letters, as halachot and chapters are counted: יא, טו, טז, קכ.
export function gematria(n: number) {
  const units = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const hundreds = ["", "ק", "ר", "ש", "ת"];
  const out = hundreds[Math.min(4, Math.floor(n / 100))] ?? "";
  const rest = n % 100;
  if (rest === 15) return out + "טו";
  if (rest === 16) return out + "טז";
  return out + tens[Math.floor(rest / 10)] + units[rest % 10];
}

// Base letters with their marks, so reversing keeps each vowel on its letter.
export function clusters(w: string) {
  const out: string[] = [];
  for (const ch of w) {
    if (MARK.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

// Words into lines of at most `width` cells; marks take no cell.
export function wrap(s: string, width: number) {
  const lines: string[][] = [];
  let line: string[] = [], n = 0;
  for (const w of s.split(" ").filter(Boolean)) {
    const c = clusters(w).length;
    if (line.length && n + 1 + c > width) { lines.push(line); line = []; n = 0; }
    n += (line.length ? 1 : 0) + c;
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}

// Visual order for a terminal that draws everything left to right (Ghostty):
// words right to left, letters inside a Hebrew word reversed, brackets
// mirrored, numbers and Latin kept as is.
export function visual(words: string[]) {
  return words
    .slice()
    .reverse()
    .map((w) => (HEB.test(w) ? clusters(w).reverse().map((c) => MIRROR[c] ?? c).join("") : w))
    .join(" ");
}

// Visual order for a terminal that turns each word around itself (macOS
// Terminal, which inside Claude Code gets the screen a word at a time): words
// right to left, letters as written, and the punctuation at each end of a word
// moved to the other end, mirrored, since the terminal leaves it where it is
// sent. No direction controls (LRM, RLM, overrides): Terminal draws them as boxes.
export function termVisual(words: string[]) {
  const across = (p: string) => [...p].reverse().map((c) => MIRROR[c] ?? c).join("");
  return words
    .slice()
    .reverse()
    .map((w) => {
      if (!HEB.test(w)) return w;
      const m = /^([^\u05D0-\u05EA\uFB1D-\uFB4F]*)(.*?)([^\u05D0-\u05EA\uFB1D-\uFB4F\u0591-\u05C7]*)$/su.exec(w)!;
      return across(m[3]!) + m[2] + across(m[1]!);
    })
    .join(" ");
}
