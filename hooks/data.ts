// The day's learning, shaped for drawing. Pure: the fetching happens in
// register.tsx, the one file the engine lets call $.
// - the band: hebcal.com (Hebrew date) and the Sefaria calendar;
// - the sidebar: scripts/chitas.py --json --full, shaped into a Day.

import type { Day, Part, TabId } from "../types";

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
export const DAY_V = 4;

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

// A Rambam reading with its halachot grouped by chapter; the first chapter's
// number comes from the ref ("Mishneh Torah, Damages to Property 12-14" → 12).
function rambamPart(title: string, r: any, chabad: string): Part {
  const p = part(title, { ...r, chabad }, r.text);
  const he: string[][] = r.text?.he_chapters ?? [];
  const en: string[][] = r.text?.en_chapters ?? [];
  const first = Number(/(\d+)(?:-\d+)?$/.exec(r.ref ?? "")?.[1] ?? 1);
  if (he.length) p.chapters = he.map((h, i) => ({ n: first + i, he: h, en: en[i] ?? [] }));
  return p;
}

// chitas.py's --json output as the Day the sidebar draws, one list of parts per tab.
export function toDay(key: string, j: any): Day {
  const s = j.sections || {};
  const ch = s.chumash, rb = s.rambam || {};
  const parts: Record<TabId, Part[]> = {
    chumash: ch ? [{
      ...part(`${ch.parsha} · ${ch.aliyah} (${ch.ref}) with Rashi`, ch, ch.text),
      ...(ch.rashi ? { rashi: { he: ch.rashi.he_verses || [], en: ch.rashi.en_verses || [] } } : {}),
    }] : [],
    tehillim: s.tehillim ? [part(`Tehillim ${s.tehillim.ref} (day ${s.tehillim.day_of_month})`, s.tehillim, s.tehillim.text)] : [],
    // "Tanya, Part IV; Iggeret HaKodesh 25:1-5" → "Iggeret HaKodesh 25:1-5"
    tanya: s.tanya ? [part(`Tanya · ${s.tanya.display} (${String(s.tanya.ref ?? "").split("; ").pop()})`, s.tanya, s.tanya.text)] : [],
    rambam1: rb.one_perek ? [rambamPart(`Rambam ×1 · ${rb.one_perek.display}`, rb.one_perek, rb.chabad)] : [],
    rambam3: rb.three_perakim ? [rambamPart(`Rambam ×3 · ${rb.three_perakim.display}`, rb.three_perakim, rb.chabad)] : [],
    hayom: s.hayom_yom ? [part(s.hayom_yom.ref, s.hayom_yom, s.hayom_yom.text)] : [],
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
