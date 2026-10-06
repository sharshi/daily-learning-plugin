import { expect, test } from "claude-code/testing";

import { briefFrom, hebrewDate } from "../hooks/data";
import { cleanHe, cleanText, gematria, markOrder, termVisual, visual, wrap } from "../hooks/hebrew";
import { SVG_LIMIT, svgPage } from "../hooks/svg";

const bare = (s: string) => s.replace(/[\u0591-\u05C7]/g, "");

test("gematria counts as halachot and chapters are numbered", () => {
  expect([1, 9, 10, 11, 14, 15, 16, 17, 20, 22, 40, 100, 120].map(gematria))
    .toEqual(["\u05D0", "\u05D8", "\u05D9", "\u05D9\u05D0", "\u05D9\u05D3", "\u05D8\u05D5", "\u05D8\u05D6", "\u05D9\u05D6", "\u05DB", "\u05DB\u05D1", "\u05DE", "\u05E7", "\u05E7\u05DB"]);
});

test("cleanText drops HTML, entities and section markers", () => {
  expect(cleanText("a&thinsp;b<br/>c <b>d</b>&nbsp;{\u05E1}&nbsp; e")).toBe("a b c d e");
});

test("cleanHe drops te'amim and paseq, and nikkud when asked", () => {
  // וַיַּפֵּל֩ יְהֹוָ֨ה ׀ — with a tarsa, a pazer and a paseq
  const s = "\u05D5\u05B7\u05D9\u05BC\u05B7\u05E4\u05BC\u05B5\u05DC\u05A9 \u05D9\u05B0\u05D4\u05B9\u05D5\u05B8\u05A8\u05D4 \u05C0 \u05EA";
  const t = cleanHe(s, true);
  expect(/[\u0591-\u05AF\u05C0]/.test(t)).toBe(false);
  expect(bare(t)).toBe("\u05D5\u05D9\u05E4\u05DC \u05D9\u05D4\u05D5\u05D4 \u05EA");
  expect(cleanHe(s, false)).toBe("\u05D5\u05D9\u05E4\u05DC \u05D9\u05D4\u05D5\u05D4 \u05EA");
});

test("markOrder puts shin dot and dagesh before the vowel", () => {
  // בְּ (bet, sheva, dagesh) → bet, dagesh, sheva; שְׁ (shin, sheva, shin dot) → shin, dot, sheva
  expect(markOrder("\u05D1\u05B0\u05BC")).toBe("\u05D1\u05BC\u05B0");
  expect(markOrder("\u05E9\u05B0\u05C1")).toBe("\u05E9\u05C1\u05B0");
  expect(markOrder("\u05E9\u05C1\u05BC\u05B8")).toBe("\u05E9\u05C1\u05BC\u05B8"); // already right
});

test("wrap counts letters, not marks", () => {
  const word = "\u05D1\u05BC\u05B0\u05EA\u05D5\u05B9"; // 3 letters, 3 marks
  expect(wrap(`${word} ${word} ${word}`, 7)).toEqual([[word, word], [word]]);
});

test("visual (Ghostty): words and letters reversed, marks kept on their letter, brackets mirrored", () => {
  expect(visual(["\u05D0\u05D1", "(\u05D2\u05D3)"])).toBe("(\u05D3\u05D2) \u05D1\u05D0");
  expect(visual(["\u05D1\u05BC\u05B8\u05D0"])).toBe("\u05D0\u05D1\u05BC\u05B8");
  expect(visual(["abc", "12"])).toBe("12 abc");
});

test("termVisual (macOS Terminal): words reversed, letters kept, edge punctuation moved across", () => {
  // "א. מדברי סופרים," → ",סופרים מדברי .א"
  expect(termVisual(["\u05D0.", "\u05DE\u05D3\u05D1\u05E8\u05D9", "\u05E1\u05D5\u05E4\u05E8\u05D9\u05DD,"]))
    .toBe(",\u05E1\u05D5\u05E4\u05E8\u05D9\u05DD \u05DE\u05D3\u05D1\u05E8\u05D9 .\u05D0");
  // "(שמות כא לד)" → "(לד כא שמות)": brackets moved across and mirrored
  expect(termVisual(["(\u05E9\u05DE\u05D5\u05EA", "\u05DB\u05D0", "\u05DC\u05D3)"]))
    .toBe("(\u05DC\u05D3 \u05DB\u05D0 \u05E9\u05DE\u05D5\u05EA)");
  // a final vowel stays on its letter; sof pasuq (a Hebrew character) stays put
  expect(termVisual(["\u05D9\u05B0\u05D4\u05B9\u05D5\u05B8\u05D4\u05C3"])).toBe("\u05D9\u05B0\u05D4\u05B9\u05D5\u05B8\u05D4\u05C3");
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

test("svgPage: right-to-left lines, labels in bold, text escaped, null past the size limit", () => {
  const svg = svgPage([
    { kind: "heading", text: "\u05E4\u05E8\u05E7 \u05D0" },
    { kind: "he", text: "\u05D0 & \u05D1", label: "\u05D0." },
    { kind: "en", text: "a <b> c", rashi: true },
    { kind: "gap" },
  ], { key: "shlomo", base64: "Zm9udA==" })!;
  expect(svg).toContain("data:font/woff;base64,Zm9udA==");
  expect(svg).toContain('<tspan class="b">\u05D0.</tspan> \u05D0 &amp; \u05D1');
  expect(svg).toContain(">a &lt;b&gt; c<");
  expect(svg.match(/direction="rtl"/g)?.length).toBe(2);
  expect(svgPage([{ kind: "he", text: "\u05D0" }], { key: "frank", base64: "A".repeat(SVG_LIMIT) })).toBe(null);
});
