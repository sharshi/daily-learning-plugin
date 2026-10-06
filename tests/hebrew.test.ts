import { expect, test } from "claude-code/testing";

import { briefFrom, hebrewDate } from "../hooks/data";
import { cleanHe, cleanText, gematria, markOrder, termVisual, visual, wrap } from "../hooks/hebrew";

const bare = (s: string) => s.replace(/[֑-ׇ]/g, "");

test("gematria counts as halachot and chapters are numbered", () => {
  expect([1, 9, 10, 11, 14, 15, 16, 17, 20, 22, 40, 100, 120].map(gematria))
    .toEqual(["א", "ט", "י", "יא", "יד", "טו", "טז", "יז", "כ", "כב", "מ", "ק", "קכ"]);
});

test("cleanText drops HTML, entities and section markers", () => {
  expect(cleanText("a&thinsp;b<br/>c <b>d</b>&nbsp;{ס}&nbsp; e")).toBe("a b c d e");
});

test("cleanHe drops te'amim and paseq, and nikkud when asked", () => {
  // וַיַּפֵּל֩ יְהֹוָ֨ה ׀ — with a tarsa, a pazer and a paseq
  const s = "וַיַּפֵּל֩ יְהֹוָ֨ה ׀ ת";
  const t = cleanHe(s, true);
  expect(/[֑-֯׀]/.test(t)).toBe(false);
  expect(bare(t)).toBe("ויפל יהוה ת");
  expect(cleanHe(s, false)).toBe("ויפל יהוה ת");
});

test("markOrder puts shin dot and dagesh before the vowel", () => {
  // בְּ (bet, sheva, dagesh) → bet, dagesh, sheva; שְׁ (shin, sheva, shin dot) → shin, dot, sheva
  expect(markOrder("בְּ")).toBe("בְּ");
  expect(markOrder("שְׁ")).toBe("שְׁ");
  expect(markOrder("שָּׁ")).toBe("שָּׁ"); // already right
});

test("wrap counts letters, not marks", () => {
  const word = "בְּתוֹ"; // 3 letters, 3 marks
  expect(wrap(`${word} ${word} ${word}`, 7)).toEqual([[word, word], [word]]);
});

test("visual (Ghostty): words and letters reversed, marks kept on their letter, brackets mirrored", () => {
  expect(visual(["אב", "(גד)"])).toBe("(דג) בא");
  expect(visual(["בָּא"])).toBe("אבָּ");
  expect(visual(["abc", "12"])).toBe("12 abc");
});

test("termVisual (macOS Terminal): words reversed, letters kept, edge punctuation moved across", () => {
  // "א. מדברי סופרים," → ",סופרים מדברי .א"
  expect(termVisual(["א.", "מדברי", "סופרים,"]))
    .toBe(",סופרים מדברי .א");
  // "(שמות כא לד)" → "(לד כא שמות)": brackets moved across and mirrored
  expect(termVisual(["(שמות", "כא", "לד)"]))
    .toBe("(לד כא שמות)");
  // a final vowel stays on its letter; sof pasuq (a Hebrew character) stays put
  expect(termVisual(["יְהֹוָה׃"])).toBe("יְהֹוָה׃");
});

test("briefFrom: Tehillim on a 29th finishes the book when the month has no 30th", () => {
  const d = new Date("2026-10-04T12:00:00");
  const heb = hebrewDate({ hd: "29", hm: "Elul", hy: "5786", hebrew: "", events: [] });
  const cal = { calendar_items: [{ title: { en: "Tanya Yomi" }, displayValue: { en: "29 Elul" } }] };
  const row = (b: ReturnType<typeof briefFrom>) => b.sections.find(([l]) => l === "Tehillim")?.[1];
  expect(row(briefFrom(d, heb, cal, true))).toBe("140-144  (day 29)");
  expect(row(briefFrom(d, heb, cal, false))).toBe("140-150  (day 29)");
  expect(briefFrom(d, heb, cal).sections.map(([l]) => l)).toEqual(["Tehillim", "Tanya", "Hayom Yom"]);
});
