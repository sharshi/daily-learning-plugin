// The Desktop app's Hebrew: one SVG per reading, with the chosen font embedded,
// so the app's own text engine shapes the nikkud and lays the lines right to
// left. The terminal draws the same Line list as text (see register.tsx).

import { ADVANCE } from "./font-metrics";

// A bundled font: which (for its letter widths), and its WOFF as base64.
export type FontKey = keyof typeof ADVANCE;
export type EmbeddedFont = { key: FontKey; base64: string };

// One line of the sidebar body, before it is drawn. A "pair" is a paragraph
// with its English beside it (English on the left, Hebrew on the right).
export type Line =
  | { kind: "he"; text: string; label?: string; rashi?: boolean }
  | { kind: "en"; text: string; label?: string; rashi?: boolean }
  | { kind: "pair"; he: string; en: string; label?: string; enLabel?: string; rashi?: boolean }
  | { kind: "heading"; text: string }
  | { kind: "gap" };

// How the page is drawn: its width in CSS pixels (the sidebar's, so the SVG
// draws at about its real size) and a text-size factor (1 = medium).
export type PageOptions = { width: number; scale: number };

// An Svg element's source is capped at 131072 characters.
export const SVG_LIMIT = 131072;

const PAD = 6;
const GUTTER = 18;
const EN_EM = 0.5; // the system sans: about half an em a character

const MARK = /[\u0591-\u05C7]/;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A Hebrew word's width in ems, by the font's own advances; marks take none.
function ems(w: string, adv: Record<number, number>) {
  let n = 0;
  for (const ch of w) if (!MARK.test(ch)) n += adv[ch.codePointAt(0)!] ?? 0.55;
  return n;
}

// Words into lines no wider than `max`, each word measured by `measure`.
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

const words = (text: string, label?: string) => [...(label ? [label] : []), ...text.split(" ").filter(Boolean)];

// The page as SVGs: one when it fits an Svg element, else several, split
// between paragraphs, each with the font. Null when even one paragraph alone
// is too big (the caller then draws it as text).
export function svgPages(lines: Line[], font: EmbeddedFont, opt: PageOptions = { width: 560, scale: 1 }): string[] | null {
  const adv = ADVANCE[font.key];
  const W = Math.max(280, Math.round(opt.width));
  // Sizes chosen to sit with the app's own ~14px text: Hebrew a little larger,
  // since a Hebrew face looks smaller than a Latin one at the same size.
  const s = opt.scale;
  const HE = { size: 18 * s, line: 30 * s };
  const EN = { size: 14 * s, line: 21 * s };
  const HEADING = { size: 19 * s, line: 32 * s };
  const GAP = 10 * s;
  const at = (n: number) => Math.round(n);

  const heLines = (text: string, label: string | undefined, width: number) =>
    fit(words(text, label), width / HE.size, (w) => ems(w, adv), adv[0x20] ?? 0.3);
  const enLines = (text: string, label: string | undefined, width: number) =>
    fit(words(text, label), width / (EN.size * EN_EM), (w) => w.length, 1);
  // Classes: h Hebrew, e English, t heading, r Rashi, b bold.
  const text = (cls: string, ws: string[], first: boolean, label: string | undefined, x: number, y: number) => {
    const head = label && first ? `<tspan class="b">${xml(ws[0]!)}</tspan> ` : "";
    const rest = xml((label && first ? ws.slice(1) : ws).join(" "));
    return `<text class="${cls}" x="${at(x)}" y="${at(y)}">${head}${rest}</text>`;
  };

  // Each paragraph (up to a gap) becomes a block of text drawn from y = 0.
  type Block = { body: string[]; height: number };
  const blocks: Block[] = [];
  let cur: Block = { body: [], height: 0 };
  const right = W - PAD;
  const full = W - 2 * PAD;
  const half = (full - GUTTER) / 2;
  for (const l of lines) {
    let y = cur.height;
    if (l.kind === "gap") {
      cur.height += GAP;
      blocks.push(cur); cur = { body: [], height: 0 };
      continue;
    }
    if (l.kind === "heading") {
      y += HEADING.line;
      cur.body.push(`<text class="t" x="${right}" y="${at(y - HEADING.line * 0.3)}">${xml(l.text)}</text>`);
    } else if (l.kind === "he") {
      heLines(l.text, l.label, full).forEach((ws, i) => {
        y += HE.line;
        cur.body.push(text(l.rashi ? "h r" : "h", ws, i === 0, l.label, right, y - HE.line * 0.3));
      });
    } else if (l.kind === "en") {
      enLines(l.text, l.label, full).forEach((ws, i) => {
        y += EN.line;
        cur.body.push(text(l.rashi ? "e r" : "e", ws, i === 0, l.label, PAD, y - EN.line * 0.28));
      });
    } else {
      // Side by side: both columns start on the same row; the taller sets the height.
      const y0 = y;
      const he = heLines(l.he, l.label, half);
      const en = enLines(l.en, l.enLabel, half);
      he.forEach((ws, i) => cur.body.push(text(l.rashi ? "h r" : "h", ws, i === 0, l.label, right, y0 + (i + 1) * HE.line - HE.line * 0.3)));
      en.forEach((ws, i) => cur.body.push(text(l.rashi ? "e r" : "e", ws, i === 0, l.enLabel, PAD, y0 + (i + 1) * EN.line - EN.line * 0.28)));
      y = y0 + Math.max(he.length * HE.line, en.length * EN.line);
    }
    cur.height = y;
  }
  if (cur.body.length || cur.height) blocks.push(cur);

  const style =
    `<style>` +
    `@font-face{font-family:DLHebrew;src:url(data:font/woff;base64,${font.base64}) format("woff")}` +
    `.h,.t{font-family:DLHebrew,"SF Hebrew","Arial Hebrew",serif;direction:rtl}` +
    `.h{font-size:${at(HE.size)}px;fill:#1f1f1f}.t{font-size:${at(HEADING.size)}px;font-weight:bold;fill:#2b8aa6}` +
    `.e{font-family:-apple-system,system-ui,sans-serif;font-size:${at(EN.size)}px;fill:#6b6b6b}` +
    `.r{fill:#4b5bd6}.b{font-weight:bold}` +
    `@media (prefers-color-scheme:dark){.h{fill:#e8e8e8}.e{fill:#a3a3a3}.r{fill:#b1b9f9}.t{fill:#62c4e0}}` +
    `</style>`;
  const svg = (parts: string[], height: number) => {
    const h = Math.ceil(height + 2 * PAD);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}">${style}` +
      `<g transform="translate(0 ${PAD})">${parts.join("")}</g></svg>`;
  };

  // Pack the blocks into as few SVGs as fit.
  const room = SVG_LIMIT - svg([], 0).length - 64;
  const pages: string[] = [];
  let parts: string[] = [], height = 0, size = 0;
  for (const b of blocks) {
    const g = `<g transform="translate(0 ${at(height)})">${b.body.join("")}</g>`;
    if (g.length > room) return null;
    if (size + g.length > room && parts.length) {
      pages.push(svg(parts, height)); parts = []; height = 0; size = 0;
      const g2 = `<g transform="translate(0 0)">${b.body.join("")}</g>`;
      parts.push(g2); size += g2.length; height += b.height;
      continue;
    }
    parts.push(g); size += g.length; height += b.height;
  }
  if (parts.length) pages.push(svg(parts, height));
  return pages;
}

// The page as one SVG, or null when it needs more than one (tests, mostly).
export function svgPage(lines: Line[], font: EmbeddedFont, opt?: PageOptions): string | null {
  const pages = svgPages(lines, font, opt);
  return pages && pages.length === 1 ? pages[0]! : null;
}
