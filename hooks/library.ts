// The Library: whole works to learn through at your own pace (Mishnayos, Shas,
// Mishneh Torah). Pure: the structure comes from Sefaria's shape API and the
// text from its texts API, both fetched by register.tsx when first needed.

import type { Coll, LibBook, LibSection, LibShape, Part, Section } from "../types";
import { gematria } from "./hebrew";

export type { Coll, LibBook, LibPos, LibSection, LibShape } from "../types";

export const COLLS: Record<Coll, { name: string; he: string; shape: string; unit: "perek" | "daf"; blurb: string }> = {
  mishnah: { name: "Mishnayos", he: "משניות", shape: "Mishnah", unit: "perek", blurb: "Six sedarim, 63 masechtos" },
  bavli: { name: "Shas", he: "ש״ס בבלי", shape: "Bavli", unit: "daf", blurb: "Talmud Bavli, daf by daf, with Rashi" },
  mt: { name: "Mishneh Torah", he: "משנה תורה", shape: "Halakhah/Mishneh Torah", unit: "perek", blurb: "The Rambam's 14 sefarim, perek by perek" },
};
export const COLL_ORDER: Coll[] = ["mishnah", "bavli", "mt"];

// Section names in Hebrew: the sedarim, and the Rambam's sefarim.
const SECTION_HE: Record<string, string> = {
  "Seder Zeraim": "סדר זרעים", "Seder Moed": "סדר מועד", "Seder Nashim": "סדר נשים",
  "Seder Nezikin": "סדר נזיקין", "Seder Kodashim": "סדר קדשים", "Seder Tahorot": "סדר טהרות",
  "Introduction": "הקדמה", "Sefer Madda": "ספר המדע", "Sefer Ahavah": "ספר אהבה", "Sefer Zemanim": "ספר זמנים",
  "Sefer Nashim": "ספר נשים", "Sefer Kedushah": "ספר קדושה", "Sefer Haflaah": "ספר הפלאה", "Sefer Zeraim": "ספר זרעים",
  "Sefer Avodah": "ספר עבודה", "Sefer Korbanot": "ספר הקרבנות", "Sefer Taharah": "ספר טהרה", "Sefer Nezikim": "ספר נזיקים",
  "Sefer Kinyan": "ספר קנין", "Sefer Mishpatim": "ספר משפטים", "Sefer Shoftim": "ספר שופטים",
};

// Sefaria's shape for a collection as sections of books, in Sefaria's order.
// Bavli's `chapters` counts segments per amud from 1a, so a daf's first amud
// is index 2(daf-1); a book's first daf is where its first text is.
export function parseShape(coll: Coll, json: unknown): LibShape {
  const sections: LibSection[] = [];
  for (const x of (Array.isArray(json) ? json : []) as any[]) {
    if (!x || typeof x.title !== "string" || x.isComplex) continue;
    const ch = x.chapters;
    let first = 1, last = typeof ch === "number" ? ch : Array.isArray(ch) ? ch.length : Number(x.length) || 0;
    if (coll === "bavli" && Array.isArray(ch)) {
      const i = ch.findIndex((n: unknown) => Number(n) > 0);
      first = Math.floor(Math.max(i, 0) / 2) + 1;
      last = Math.floor((ch.length - 1) / 2) + 1;
    }
    if (last < first) continue;
    const name = coll === "mishnah" ? x.title.replace(/^Mishnah /, "")
      : coll === "mt" ? x.title.replace(/^Mishneh Torah, /, "") : x.title;
    const he = String(x.heTitle ?? x.heBook ?? "").replace(/^משנה תורה, /, "").replace(/^משנה /, "");
    const sec = String(x.section ?? "");
    let s = sections.find((y) => y.name === sec);
    if (!s) sections.push(s = { name: sec, he: SECTION_HE[sec] ?? sec, books: [] });
    s.books.push({ title: x.title, he, name, section: sec, first, last });
  }
  return { sections };
}

export const books = (shape: LibShape) => shape.sections.flatMap((s) => s.books);
export const findBook = (shape: LibShape, title?: string) => books(shape).find((b) => b.title === title);

// A unit's name: פרק ג, or דף ה.
export const unitName = (coll: Coll, n: number) => `${COLLS[coll].unit === "daf" ? "דף" : "פרק"} ${gematria(n)}`;
// The same in English, for buttons and titles: "Berakhot 5", "Sabbath 3".
export const unitLabel = (b: LibBook, n: number) => `${b.name} ${n}`;

// The next or previous unit, across books: after a book's last unit comes the
// next book's first, and before its first, the previous book's last.
export function step(shape: LibShape, title: string, unit: number, dir: 1 | -1): { book: LibBook; unit: number } | null {
  const all = books(shape);
  const i = all.findIndex((b) => b.title === title);
  if (i < 0) return null;
  const b = all[i]!;
  const u = unit + dir;
  if (u >= b.first && u <= b.last) return { book: b, unit: u };
  const nb = all[i + dir];
  return nb ? { book: nb, unit: dir > 0 ? nb.first : nb.last } : null;
}

// Sefaria refs for a unit, and for its Rashi (Shas only).
export const textRef = (b: LibBook, unit: number) => `${b.title} ${unit}`;
export const rashiRef = (b: LibBook, unit: number) => `Rashi on ${b.title} ${unit}`;

// A texts API reply as he/en lists of paragraphs, by section when nested
// (a daf's two amudim), with the ref Sefaria resolved ("Berakhot 64a").
type Versions = { ref?: string; versions?: { language?: string; text?: unknown }[] };
const flat = (v: unknown): string[] => v == null ? [] : Array.isArray(v) ? v.flatMap(flat) : [String(v)];
function byLang(j: Versions) {
  const out: { he: unknown; en: unknown } = { he: [], en: [] };
  for (const v of j.versions ?? []) out[v.language === "he" ? "he" : "en"] = v.text ?? [];
  return out;
}
const nested = (t: unknown): unknown[][] =>
  Array.isArray(t) && t.length && t.every((x) => Array.isArray(x)) ? (t as unknown[][]) : [Array.isArray(t) ? t : []];

// The Part the sidebar draws for one unit. A perek is one numbered section; a
// daf is its amudim, each passage with its Rashi.
export function libPart(coll: Coll, b: LibBook, unit: number, text: Versions, rashi?: Versions): Part {
  const { he, en } = byLang(text);
  const title = `${COLLS[coll].name} · ${unitLabel(b, unit)}`;
  const link = `https://www.sefaria.org/${encodeURIComponent(textRef(b, unit).replace(/ /g, "_"))}`;
  if (coll !== "bavli") {
    const s: Section = { name: `${b.he} ${unitName(coll, unit)}`, short: gematria(unit), he: flat(he), en: flat(en) };
    return { title, link, he: s.he, en: s.en, sections: [s], numbered: true };
  }
  // A daf: one section per amud.
  // Sefaria resolves a one-amud daf to "64a"; then the text is one amud, and
  // Rashi's lists are per passage, not per amud.
  const single = /\d+([ab])$/.exec(text.ref ?? "")?.[1];
  const heA = nested(he), enA = nested(en);
  const rHe = rashi ? byLang(rashi).he : [];
  const rA = single ? [Array.isArray(rHe) ? rHe : []] : nested(rHe);
  const sections: Section[] = heA.map((h, i) => {
    const side = single ?? (i === 0 ? "a" : "b");
    const short = `${gematria(unit)}${side === "a" ? "." : ":"}`;
    return {
      name: `${b.he} דף ${short}`, short, he: flat(h), en: flat(enA[i]),
      rashi: (rA[i] ?? []).map((seg) => flat(seg)),
    };
  }).filter((s) => s.he.length || s.en.length);
  return { title, link, he: sections.flatMap((s) => s.he), en: sections.flatMap((s) => s.en), sections, unit: "amud" };
}
