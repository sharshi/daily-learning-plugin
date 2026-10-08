// The day's learning, shaped for drawing. Pure: the fetching happens in
// register.tsx, the one file the engine lets call $.
// - the band: hebcal.com (Hebrew date) and the Sefaria calendar;
// - the sidebar: scripts/dl.py --json --full, shaped into a Day.

import type { Day, Part, Section, TabId } from "../types";
import { gematria } from "./hebrew";
import type { Line } from "./svg";

const ALIYOT = ["Rishon", "Sheini", "Shlishi", "Revi'i", "Chamishi", "Shishi", "Shvi'i"];
const TEHILLIM: Record<number, string> = {
  1: "1-9", 2: "10-17", 3: "18-22", 4: "23-28", 5: "29-34", 6: "35-38", 7: "39-43",
  8: "44-48", 9: "49-54", 10: "55-59", 11: "60-65", 12: "66-68", 13: "69-71",
  14: "72-76", 15: "77-78", 16: "79-82", 17: "83-87", 18: "88-89", 19: "90-96",
  20: "97-103", 21: "104-105", 22: "106-107", 23: "108-112", 24: "113-118",
  25: "119:1-96", 26: "119:97-176", 27: "120-134", 28: "135-139", 29: "140-144",
  30: "145-150",
};
const HEB_MONTH: Record<string, string> = { "Sh'vat": "Shevat", Iyyar: "Iyar", Tamuz: "Tammuz" };

// Shape version of a cached Day: bump it when Day changes, and old caches refetch.
export const DAY_V = 8;

// What the band shows: the Hebrew date and one [label, ref] row per section.
export type Brief = {
  heb: { hd: number; hm: string; hy: number; hebrew: string; events: string[] };
  sections: [string, string][];
};

// The local Gregorian date as YYYY-MM-DD: what caches are keyed by.
export function todayKey(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- band ---------------------------------------------------------------
export const hebcalUrl = (d: Date) =>
  `https://www.hebcal.com/converter?cfg=json&g2h=1&gy=${d.getFullYear()}&gm=${d.getMonth() + 1}&gd=${d.getDate()}`;
export const calendarUrl = (d: Date) =>
  `https://www.sefaria.org/api/calendars?year=${d.getFullYear()}&month=${d.getMonth() + 1}&day=${d.getDate()}&diaspora=1`;

// hebcal's converter reply as the band's Hebrew date.
export function hebrewDate(j: any): Brief["heb"] {
  return { hd: +j.hd, hm: j.hm, hy: +j.hy, hebrew: j.hebrew || "", events: j.events || [] };
}

// The band's rows for Gregorian day `d`, from its Hebrew date and Sefaria
// calendar. `monthHas30` says whether this Hebrew month has a 30th day: on a
// 29th without one, Tehillim finishes the book (140-150).
export function briefFrom(d: Date, heb: Brief["heb"], cal: any, monthHas30 = true): Brief {
  const items = Object.fromEntries((cal.calendar_items || []).map((i: any) => [i.title.en, i]));
  const out: Brief = { heb, sections: [] };

  const par = items["Parashat Hashavua"];
  if (par) {
    const wd = d.getDay(); // Sun=0 … Sat=6
    const aliyot = par.extraDetails?.aliyot || [];
    const ref = aliyot[wd] || par.ref;
    out.sections.push(["Chumash", `${par.displayValue.en} · ${ALIYOT[wd]} (${ref})`]);
  }

  const teh = heb.hd === 29 && !monthHas30 ? "140-150" : TEHILLIM[heb.hd];
  out.sections.push(["Tehillim", `${teh}  (day ${heb.hd})`]);

  const tanya = items["Tanya Yomi"];
  if (tanya) out.sections.push(["Tanya", tanya.displayValue.en]);

  const r3 = items["Daily Rambam (3 Chapters)"], r1 = items["Daily Rambam"];
  if (r3) out.sections.push(["Rambam ×3", r3.displayValue.en]);
  if (r1) out.sections.push(["Rambam ×1", r1.displayValue.en]);

  out.sections.push(["Hayom Yom", `${HEB_MONTH[heb.hm] || heb.hm} ${heb.hd}`]);

  const daf = items["Daf Yomi"];
  if (daf) out.sections.push(["Daf Yomi", daf.displayValue.en]);
  return out;
}

// ---- sidebar ------------------------------------------------------------
// Sefaria nests chapters as arrays of arrays; flatten to paragraphs.
function flat(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(flat);
  return [String(v)];
}

function part(title: string, s: any, text: any): Part {
  return { title, link: s?.link, chabad: s?.chabad, he: flat(text?.he), en: flat(text?.en) };
}

// Each verse of a Chumash reading numbered as Rambam's halachot are ("כא.",
// "21."), with a heading where each chapter starts (פרק ד) as Rambam's perakim
// have. From the ref's start ("Genesis 2:20-3:21") and the text's chapters,
// which a range spanning several needs; none when the counts don't add up.
export function verseLabels(ref: string, text: any): NonNullable<Part["labels"]> | undefined {
  const m = /(\d+):(\d+)(-\d+:\d+)?(?:-\d+)?$/.exec(ref ?? "");
  const verses = flat(text?.he).length;
  if (!m || !verses) return undefined;
  const chapters: number[] = Array.isArray(text?.he_chapters) && text.he_chapters.length
    ? text.he_chapters.map((c: unknown[]) => c.length)
    : m[3] ? [] : [verses];
  if (chapters.reduce((a, b) => a + b, 0) !== verses) return undefined;
  const out: NonNullable<Part["labels"]> = [];
  chapters.forEach((n, ci) => {
    const c = Number(m[1]) + ci;
    for (let k = 0; k < n; k++) {
      const v = (ci === 0 ? Number(m[2]) : 1) + k;
      out.push({ he: `${gematria(v)}.`, en: `${v}.`, ...(k === 0 ? { heading: `פרק ${gematria(c)}` } : {}) });
    }
  });
  return out;
}

// A Rambam reading, one perek at a time, its halachot numbered; the first
// perek's number comes from the ref ("Mishneh Torah, Damages to Property 12-14" → 12).
function rambamPart(title: string, r: any, chabad: string): Part {
  const p = part(title, { ...r, chabad }, r.text);
  const he: string[][] = r.text?.he_chapters ?? [];
  const en: string[][] = r.text?.en_chapters ?? [];
  const first = Number(/(\d+)(?:-\d+)?$/.exec(r.ref ?? "")?.[1] ?? 1);
  if (he.length) {
    p.sections = he.map((h, i): Section => ({
      name: `פרק ${gematria(first + i)}`, short: gematria(first + i), he: h, en: en[i] ?? [],
    }));
    p.unit = "perek";
    p.numbered = true;
  }
  return p;
}

// The daf, one amud at a time ("18a" → דף יח., "18b" → דף יח:), each passage
// with its Rashi.
function dafPart(d: any): Part {
  const amudim: any[] = d.amudim ?? [];
  const p: Part = { title: `Daf Yomi · ${d.display}`, link: d.link, he: [], en: [] };
  if (!amudim.length) return p;
  p.sections = amudim.map((a): Section => {
    const m = /^(\d+)([ab])$/.exec(a.amud ?? "");
    const short = m ? `${gematria(Number(m[1]))}${m[2] === "a" ? "." : ":"}` : String(a.amud ?? "");
    return { name: `דף ${short}`, short, he: a.he ?? [], en: a.en ?? [], rashi: a.rashi_he ?? [] };
  });
  p.he = amudim.flatMap((a) => a.he ?? []);
  p.en = amudim.flatMap((a) => a.en ?? []);
  p.unit = "amud";
  return p;
}

// dl.py's --json output as the Day the sidebar draws, one list of parts per tab.
export function toDay(key: string, j: any): Day {
  const s = j.sections || {};
  const ch = s.chumash, rb = s.rambam || {};
  const labels = ch && verseLabels(ch.ref, ch.text);
  const parts: Record<TabId, Part[]> = {
    chumash: ch ? [{
      ...part(`${ch.parsha} · ${ch.aliyah} (${ch.ref}) with Rashi`, ch, ch.text),
      ...(labels ? { labels } : {}),
      ...(ch.rashi ? { rashi: { he: ch.rashi.he_verses || [], en: ch.rashi.en_verses || [] } } : {}),
    }] : [],
    tehillim: s.tehillim ? [part(`Tehillim ${s.tehillim.ref} (day ${s.tehillim.day_of_month})`, s.tehillim, s.tehillim.text)] : [],
    // "Tanya, Part IV; Iggeret HaKodesh 25:1-5" → "Iggeret HaKodesh 25:1-5"
    tanya: s.tanya ? [part(`Tanya · ${s.tanya.display} (${String(s.tanya.ref ?? "").split("; ").pop()})`, s.tanya, s.tanya.text)] : [],
    rambam1: rb.one_perek ? [rambamPart(`Rambam ×1 · ${rb.one_perek.display}`, rb.one_perek, rb.chabad)] : [],
    rambam3: rb.three_perakim ? [rambamPart(`Rambam ×3 · ${rb.three_perakim.display}`, rb.three_perakim, rb.chabad)] : [],
    hayom: s.hayom_yom ? [part(s.hayom_yom.ref, s.hayom_yom, s.hayom_yom.text)] : [],
    daf: s.daf_yomi ? [dafPart(s.daf_yomi)] : [],
  };
  const hd = j.hebrew || {};
  return {
    v: DAY_V,
    key,
    title: `${j.weekday} ${j.gregorian} · ${hd.hd} ${hd.hm} ${hd.hy}`,
    hebrew: hd.hebrew || "",
    parts,
    errors: j.errors || [],
  };
}

// How the body shows English and Rashi (the sidebar's settings).
export type English = "off" | "staggered" | "side";
export type LineOptions = { english: English; rashi: boolean };

// What a part draws, line by line: for a sectioned part, section `at` under
// its heading; otherwise verse by verse. Each paragraph is followed by its
// English (staggered: under it; side: beside it) and its Rashi.
export function linesFor(p: Part, at: number, opt: LineOptions): Line[] {
  const out: Line[] = [];
  const showEn = opt.english !== "off";
  const para = (he: string[], en: string[], rashi: string[][] | undefined, rashiEn: string[][] | undefined,
    numbered: boolean, labels?: Part["labels"]) => {
    const paired = he.length === en.length;
    // Rashi lines up with the paragraphs when it has no more entries than they
    // do: Sefaria leaves the list short when the last ones have no Rashi.
    const r = opt.rashi && rashi && rashi.length <= he.length ? rashi : null;
    he.forEach((h, i) => {
      if (labels?.[i]?.heading) out.push({ kind: "heading", text: labels[i]!.heading! });
      const label = numbered ? `${gematria(i + 1)}.` : labels?.[i]?.he;
      const enLabel = numbered ? `${i + 1}.` : labels?.[i]?.en;
      if (opt.english === "side" && paired) {
        out.push({ kind: "pair", he: h, en: en[i]!, ...(label ? { label, enLabel } : {}) });
      } else {
        out.push({ kind: "he", text: h, ...(label ? { label } : {}) });
        if (showEn && paired) out.push({ kind: "en", text: en[i]!, ...(enLabel ? { label: enLabel } : {}) });
      }
      const rh = r?.[i] ?? [], re = showEn && r ? rashiEn?.[i] ?? [] : [];
      if (opt.english === "side" && rh.length && rh.length === re.length) {
        rh.forEach((c, j) => out.push({ kind: "pair", he: c, en: re[j]!, rashi: true }));
      } else {
        rh.forEach((c) => out.push({ kind: "he", text: c, rashi: true }));
        re.forEach((c) => out.push({ kind: "en", text: c, rashi: true }));
      }
      out.push({ kind: "gap" });
    });
    if (showEn && !paired) en.forEach((x) => out.push({ kind: "en", text: x }, { kind: "gap" }));
    // Rashi that did not line up with the paragraphs still shows, after them.
    if (opt.rashi && rashi && !r) rashi.flat().forEach((c) => out.push({ kind: "he", text: c, rashi: true }));
  };
  if (p.sections?.length) {
    const s = p.sections[Math.min(Math.max(at, 0), p.sections.length - 1)]!;
    out.push({ kind: "heading", text: s.name });
    para(s.he, s.en, s.rashi, undefined, !!p.numbered);
  } else {
    para(p.he, p.en, p.rashi?.he, p.rashi?.en, false, p.labels);
  }
  return out;
}
