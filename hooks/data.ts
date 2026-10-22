// The day's learning, shaped for drawing. Pure: the fetching happens in
// register.tsx, the one file the engine lets call $.
// - the band: Shafeh Today;
// - the sidebar: scripts/dl.py --json --full, shaped into a Day.

import type { Day, Part, Section, TabId } from "../types";
import { gematria } from "./hebrew";
import type { Line } from "./svg";

// Bump when the provider or Day shape changes so old cached readings refetch.
export const DAY_V = 9;

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
export const calendarUrl = (d: Date) => `https://shafeh.org/api/v1/today?date=${todayKey(d)}`;

export function briefFrom(j: any): Brief {
  const h = j.hebrew_date ?? {};
  const labels: Record<string, string> = { chitas_chumash: "Chumash", tehillim: "Tehillim", chitas_tanya: "Tanya",
    rambam: "Rambam ×3", rambam_1: "Rambam ×1", hayom_yom: "Hayom Yom", daf_yomi: "Daf Yomi" };
  return {
    heb: { hd: h.day, hm: h.month_name, hy: h.year, hebrew: h.hebrew ?? "", events: j.holiday ? [j.holiday.english] : [] },
    sections: (j.limudim ?? []).filter((r: any) => labels[r.key]).map((r: any) => [labels[r.key], r.value]),
  };
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
function rambamPart(title: string, r: any, chabad?: string): Part {
  const p = part(title, { ...r, chabad }, r.text);
  if (r.chapters?.length) {
    p.sections = r.chapters.map((c: any): Section => ({ name: `${c.name} · פרק ${gematria(c.number)}`,
      short: gematria(c.number), he: c.he, en: c.en }));
    p.he = p.sections!.flatMap((s) => s.he);
    p.en = p.sections!.flatMap((s) => s.en);
    p.unit = "perek";
    p.numbered = true;
    return p;
  }
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
    return { name: `דף ${short}`, short, he: a.he ?? [], en: a.en ?? [], rashi: a.rashi_he ?? [], notes: a.rashi_notes ?? [] };
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
    tanya: s.tanya ? [part(`Tanya · ${s.tanya.display}${s.tanya.ref && s.tanya.ref !== s.tanya.display ? ` (${String(s.tanya.ref).split("; ").pop()})` : ""}`, s.tanya, s.tanya.text)] : [],
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
    if (opt.rashi && s.notes?.length) {
      out.push({ kind: "heading", text: "רש״י" });
      s.notes.forEach((text) => out.push({ kind: "he", text, rashi: true }, { kind: "gap" }));
    }
  } else {
    para(p.he, p.en, p.rashi?.he, p.rashi?.en, false, p.labels);
  }
  return out;
}
