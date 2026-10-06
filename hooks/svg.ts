// The Desktop app's Hebrew: one SVG per reading, with the chosen font embedded,
// so the app's own text engine shapes the nikkud and lays the lines right to
// left. The terminal draws the same Line list as text (see register.tsx).

import { ADVANCE } from "./font-metrics";

// A bundled font: which (for its letter widths), and its WOFF as base64.
export type FontKey = keyof typeof ADVANCE;
export type EmbeddedFont = { key: FontKey; base64: string };

// One line of the sidebar body, before it is drawn.
export type Line =
  | { kind: "he"; text: string; label?: string; rashi?: boolean }
  | { kind: "en"; text: string; label?: string; rashi?: boolean }
  | { kind: "heading"; text: string }
  | { kind: "gap" };

// An Svg element's source is capped at 131072 characters.
export const SVG_LIMIT = 131072;

const W = 640;
const PAD = 6;
const HE = { size: 22, line: 36 };
const EN = { size: 15, line: 22, em: 0.5 }; // system sans: about half an em a character
const HEADING = { size: 24, line: 40 };
const GAP = 14;

const MARK = /[\u0591-\u05C7]/;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A Hebrew word's width in ems, by the font's own advances; marks take none.
function ems(w: string, adv: Record<number, number>) {
  let n = 0;
  for (const ch of w) if (!MARK.test(ch)) n += adv[ch.codePointAt(0)!] ?? 0.55;
  return n;
}

// Words into lines no wider than `max` ems, each word measured by `measure`.
function fit(words: string[], max: number, measure: (w: string) => number, space: number) {
  const lines: string[][] = [];
  let line: string[] = [], n = 0;
  for (const w of words) {
    const c = measure(w);
    if (line.length && n + space + c > max) { lines.push(line); line = []; n = 0; }
    n += (line.length ? space : 0) + c;
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}

// The page as one SVG, or null when it would not fit an Svg element (the
// caller then draws it as text).
export function svgPage(lines: Line[], font: EmbeddedFont): string | null {
  const adv = ADVANCE[font.key];
  const body: string[] = [];
  let y = PAD;
  const right = W - PAD;
  const heMax = (W - 2 * PAD) / HE.size;
  for (const l of lines) {
    if (l.kind === "gap") { y += GAP; continue; }
    if (l.kind === "heading") {
      y += HEADING.line;
      body.push(`<text class="h" x="${right}" y="${y - 10}" direction="rtl">${xml(l.text)}</text>`);
      continue;
    }
    if (l.kind === "he") {
      const words = [...(l.label ? [l.label] : []), ...l.text.split(" ").filter(Boolean)];
      fit(words, heMax, (w) => ems(w, adv), adv[0x20] ?? 0.3).forEach((ws, i) => {
        y += HE.line;
        const head = l.label && i === 0 ? `<tspan class="b">${xml(ws[0]!)}</tspan> ` : "";
        const rest = xml((l.label && i === 0 ? ws.slice(1) : ws).join(" "));
        body.push(`<text class="he${l.rashi ? " r" : ""}" x="${right}" y="${y - 10}" direction="rtl">${head}${rest}</text>`);
      });
      continue;
    }
    const words = [...(l.label ? [l.label] : []), ...l.text.split(" ").filter(Boolean)];
    fit(words, (W - 2 * PAD) / (EN.size * EN.em), (w) => w.length, 1).forEach((ws, i) => {
      y += EN.line;
      const head = l.label && i === 0 ? `<tspan class="b">${xml(ws[0]!)}</tspan> ` : "";
      const rest = xml((l.label && i === 0 ? ws.slice(1) : ws).join(" "));
      body.push(`<text class="en${l.rashi ? " r" : ""}" x="${PAD}" y="${y - 6}">${head}${rest}</text>`);
    });
  }
  const h = Math.ceil(y + PAD);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}">` +
    `<style>` +
    `@font-face{font-family:DLHebrew;src:url(data:font/woff;base64,${font.base64}) format("woff")}` +
    `.he,.h{font-family:DLHebrew,"SF Hebrew","Arial Hebrew",serif}` +
    `.he{font-size:${HE.size}px;fill:#1f1f1f}.h{font-size:${HEADING.size}px;font-weight:bold;fill:#2b8aa6}` +
    `.en{font-family:-apple-system,system-ui,sans-serif;font-size:${EN.size}px;fill:#6b6b6b}` +
    `.r{fill:#9b3f8c}.b{font-weight:bold}` +
    `@media (prefers-color-scheme:dark){.he{fill:#e8e8e8}.en{fill:#a3a3a3}.r{fill:#d98fd0}.h{fill:#62c4e0}}` +
    `</style>` +
    body.join("") +
    `</svg>`;
  return svg.length <= SVG_LIMIT ? svg : null;
}
