import { expect, test } from "claude-code/testing";
import { DAY_V, linesFor, toDay } from "../hooks/data";

const day = () => toDay("2026-10-22", {
  gregorian: "2026-10-22", weekday: "Thursday", hebrew: { hd: 11, hm: "Cheshvan", hy: 5787 },
  sections: {
    tanya: { ref: "Iggeret HaKodesh · Epistle 27", display: "Iggeret HaKodesh · Epistle 27", text: { he: ["קטע"], en: ["daily paragraph"] } },
    hayom_yom: { ref: "Hayom Yom · 11 Cheshvan", text: { he: ["פתגם"], en: ["teaching"] } },
    rambam: { three_perakim: { display: "A 10; B 1–2", chapters: [
      { name: "הלכות א", number: 10, he: ["הלכה א"], en: ["law one"] },
      { name: "הלכות ב", number: 1, he: ["הלכה ב"], en: ["law two"] },
      { name: "הלכות ב", number: 2, he: ["הלכה ג"], en: ["law three"] },
    ] } },
    daf_yomi: { display: "Berakhot 64", amudim: [{ amud: "64a", he: ["גמרא"], en: [], rashi_notes: ["דיבור — פירוש"] }] },
  }, errors: [],
});

test("native Shafeh day has English, Hayom Yom and provider-versioned caches", () => {
  const d = day();
  expect(d.v).toBe(DAY_V);
  expect(DAY_V).toBeGreaterThan(8);
  expect(d.parts.tanya[0]!.en).toEqual(["daily paragraph"]);
  expect(d.parts.hayom[0]!.he).toEqual(["פתגם"]);
});

test("Rambam keeps each chapter number across hilchos", () => {
  const part = day().parts.rambam3[0]!;
  expect(part.sections!.map((s) => s.short)).toEqual(["י", "א", "ב"]);
  const lines = linesFor(part, 1, { english: "staggered", rashi: false });
  expect(lines.some((l) => l.kind === "heading" && l.text.includes("פרק א"))).toBe(true);
  expect(lines.some((l) => l.kind === "en" && l.text === "law two")).toBe(true);
});

test("Shafeh Rashi is an amud-level section and obeys the Rashi preference", () => {
  const part = day().parts.daf[0]!;
  const on = linesFor(part, 0, { english: "off", rashi: true });
  expect(on.some((l) => l.kind === "heading" && l.text === "רש״י")).toBe(true);
  expect(on.some((l) => l.kind === "he" && l.text === "דיבור — פירוש" && l.rashi)).toBe(true);
  const off = linesFor(part, 0, { english: "off", rashi: false });
  expect(off.some((l) => l.kind === "he" && l.rashi)).toBe(false);
  expect(part.sections!.map((s) => s.short)).toEqual(["סד."]);
});
