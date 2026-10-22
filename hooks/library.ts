// Shafeh's library indexes and bundled text, fetched lazily by register.tsx.
import type { Coll, LibBook, LibSection, LibShape, Part, Section } from "../types";
import { gematria } from "./hebrew";
export type { Coll, LibBook, LibPos, LibSection, LibShape } from "../types";

export const COLLS: Record<Coll, { name: string; he: string; shape: string; unit: "perek" | "daf"; blurb: string }> = {
  mishnah: { name: "Mishnayos", he: "משניות", shape: "mishnah", unit: "perek", blurb: "Six sedarim, 63 masechtos" },
  bavli: { name: "Shas", he: "ש״ס בבלי", shape: "shas", unit: "daf", blurb: "Talmud Bavli, daf by daf, with Rashi" },
  mt: { name: "Mishneh Torah", he: "משנה תורה", shape: "rambam", unit: "perek", blurb: "The Rambam's 14 sefarim, perek by perek" },
};
export const COLL_ORDER: Coll[] = ["mishnah", "bavli", "mt"];

// Keep titles stable across the provider change, so existing Continue bookmarks survive.
const LEGACY_NAMES: Record<string, string> = {
  berachos: "Berakhot", shabbos: "Shabbat", sukkah: "Sukkah", taanis: "Taanit", yevamos: "Yevamot",
  kesubos: "Ketubot", gitin: "Gittin", bava_basra: "Bava Batra", makkos: "Makkot", shevuos: "Shevuot",
  horiyos: "Horayot", horayos: "Horayot", menachos: "Menachot", bechoros: "Bekhorot", arachin: "Arakhin", kerisos: "Keritot",
  midos: "Middot", middos: "Middot", nedarim: "Nedarim", kilayim: "Kilayim", sheviis: "Sheviit", terumos: "Terumot",
  maasros: "Maasrot", chalah: "Challah", bikurim: "Bikkurim", eduyos: "Eduyot", avos: "Avot",
  keilim: "Kelim", ohalos: "Oholot", negaim: "Negaim", taharos: "Tahorot", mikvaos: "Mikvaot",
  machshirin: "Makhshirin", tvul_yom: "Tevul Yom", uktzin: "Oktzin",
};
export function parseShape(coll: Coll, json: any): LibShape {
  const sections: LibSection[] = [];
  for (const s of (coll === "mt" ? json.sefarim : json.sedarim) ?? []) {
    const name = coll === "mt" ? `Sefer ${s.sefer}` : `Seder ${s.en}`;
    const books: LibBook[] = (coll === "mt" ? s.sections : s.masechtos).map((b: any) => {
      const key = b.key ?? b.slug;
      const en = LEGACY_NAMES[key] ?? b.en ?? b.name;
      const title = coll === "mishnah" && key === "avos" ? "Pirkei Avot" : coll === "mt" ? `Mishneh Torah, ${en}` : coll === "mishnah" ? `Mishnah ${en}` : en;
      return { key, title, he: b.he, name: en, section: name,
        first: coll === "bavli" ? parseInt(b.first_amud, 10) : 1,
        last: coll === "bavli" ? parseInt(b.last_amud, 10) : (b.perakim ?? b.chapters) };
    });
    sections.push({ name, he: s.he, books });
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

// Stable display/cache identity; requests use the book's explicit corpus key.
export const textRef = (b: LibBook, unit: number) => `${b.title} ${unit}`;

export function libPart(coll: Coll, b: LibBook, unit: number, text: any): Part {
  const title = `${COLLS[coll].name} · ${unitLabel(b, unit)}`;
  const path = coll === "mt" ? "rambam" : coll === "mishnah" ? "mishnah" : "shas";
  const link = coll === "mishnah" ? "https://shafeh.org/api/v1/mishnah/" + b.key + "/" + unit
    : `https://shafeh.org/${path}/${b.key}/${coll === "bavli" ? text.amudim[0].daf : unit}`;
  if (coll !== "bavli") {
    const values = coll === "mt" ? text.halachos : text.mishnayos;
    const s: Section = { name: `${b.he} ${unitName(coll, unit)}`, short: gematria(unit),
      he: values.map((v: any) => v.text ?? v.he), en: values.some((v: any) => v.english) ? values.map((v: any) => v.english ?? "") : [] };
    return { title, link, he: s.he, en: s.en, sections: [s], numbered: true };
  }
  const sections: Section[] = text.amudim.map((a: any) => {
    const short = `${gematria(unit)}${a.daf.endsWith("a") ? "." : ":"}`;
    return { name: `${b.he} דף ${short}`, short, he: a.lines.map((v: any) => v.he), en: [],
      notes: (a.rashi ?? []).map((r: any) => `${r.d} — ${r.c}`) };
  });
  return { title, link, he: sections.flatMap((s) => s.he), en: [], sections, unit: "amud" };
}
