import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import fixture from "./fixture-day";

const PROPS = {
  title: "Chitas", isFocused: true, bodyColumns: 60, placement: "dock" as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
};
// The test environment has timers; its type library doesn't declare them.
declare const setTimeout: (fn: (v?: unknown) => void, ms: number) => unknown;
const settle = () => new Promise((r) => setTimeout(r, 500));

// What the engine does beneath the mod: the script, the store, the pane, the band's fetches.
function host(on: On, script?: (argv: string[]) => { exitCode: number; stdout: string; stderr: string }, term = "ghostty") {
  on("env.get", async (_$, e: any) => ({ value: e.name === "TERM_PROGRAM" ? term : undefined }) as never);
  const store = new Map<string, unknown>();
  const opened: string[] = [];
  on("process.run", async (_$, e: any) =>
    ({ value: script && String(e.argv?.[1] ?? "").endsWith("install-font.sh")
      ? script(e.argv)
      : { exitCode: 0, stdout: JSON.stringify(fixture), stderr: "" } }) as never);
  on("store.get", async (_$, e: any) => ({ value: store.get(e.key) }) as never);
  on("store.set", async (_$, e: any) => { store.set(e.key, e.value); return { value: undefined } as never; });
  on("store.keys", async () => ({ value: [...store.keys()] }) as never);
  on("store.delete", async (_$, e: any) => { store.delete(e.key); return { value: undefined } as never; });
  on("ui.open", async (_$, e: any) => { opened.push(e.id); return { value: { isPlaced: true } } as never; });
  on("command.register", async () => ({ value: undefined }) as never);
  on("http.fetch", async (_$, e: any) => {
    const body = e.url.includes("hebcal")
      ? { hd: 25, hm: "Tishrei", hy: 5787, hebrew: "", events: ["Parashat Bereshit"] }
      : { calendar_items: [{ title: { en: "Tanya Yomi" }, displayValue: { en: "25 Tishrei" } }] };
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } } as never;
  });
  return { opened, clock: mock.clock(on) };
}

test("pane shows the Chumash text after /chitas-pane", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "chitas-pane", args: "" } as never);
  await settle();
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ plugin: "chitas", surface, component: "Pane", requestId: "chitas", props: PROPS as never });
    expect(JSON.stringify(await ui.drawn())).toContain("Bereshit");
    for (const tab of ["chumash", "tehillim", "tanya", "rambam1", "rambam3"]) {
      await ui.press({ key: `tab-${tab}` } as never);
      const text = (await ui.findAll({ type: "Text" })).map((t) => t.text).join("\n");
      expect(text.length).toBeLessThan(100_000);
      expect(text).not.toContain("&thinsp;");
    }
    await ui.press({ key: "tab-chumash" } as never);
  }
});

test("pane loads its text by itself when drawn", { timeoutMs: 20000 }, async ($, on) => {
  const { clock } = host(on);
  const ui = await $.ui.mount({ plugin: "chitas", surface: "terminal", component: "Pane", requestId: "chitas", props: PROPS as never });
  await clock.advance(1);
  await settle();
  expect(JSON.stringify(await ui.drawn())).toContain("Bereshit");
});

test("clicking a band row opens the pane on that section", { timeoutMs: 20000 }, async ($, on) => {
  const { opened } = host(on);
  const band = await $.ui.mount({ plugin: "chitas", surface: "terminal", component: "AbovePrompt", props: {} as never });
  await settle();
  await band.press({ key: "row-Tanya" } as never);
  expect(opened).toContain("chitas");
  await settle();
  const pane = await $.ui.mount({ plugin: "chitas", surface: "terminal", component: "Pane", requestId: "chitas", props: PROPS as never });
  expect(JSON.stringify(await pane.drawn())).toContain("Tanya · 25 Tishrei");
});

test("Chumash shows each verse's Rashi under it; English is a toggle", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "chitas-pane", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "chitas", surface: "desktop", component: "Pane", requestId: "chitas", props: PROPS as never });
  const texts = async () => (await ui.findAll({ type: "Text" })).map((t) => t.text);
  let t = await texts();
  // Rashi on 2:21 (מצלעותיו) sits after verse 2:21 and before verse 2:22.
  const bare = (x: string) => x.replace(/[\u0591-\u05C7\u200F]/g, "");
  const v21 = t.findIndex((x) => bare(x).startsWith("ויפל"));
  const r21 = t.findIndex((x) => bare(x).startsWith("מצלעותיו"));
  const v22 = t.findIndex((x) => bare(x).startsWith("ויבן"));
  expect(v21).toBeGreaterThan(-1);
  expect(r21).toBeGreaterThan(v21);
  expect(v22).toBeGreaterThan(r21);
  expect(t.some((x) => x.includes("deep sleep"))).toBe(false);
  await ui.press({ key: "english" } as never);
  t = await texts();
  expect(t.some((x) => x.includes("deep sleep"))).toBe(true);
});

test("Rambam ×3 has its text", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "chitas-pane", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "chitas", surface: "desktop", component: "Pane", requestId: "chitas", props: PROPS as never });
  await ui.press({ key: "tab-rambam3" } as never);
  const t = (await ui.findAll({ type: "Text" })).map((x) => x.text).join("\n");
  expect(t).toContain("Rambam ×3");
  expect(t).not.toContain("Rambam ×1");
  expect(t).not.toContain("No text from Sefaria");
});

test("Hayom Yom is left out when its text did not load", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "chitas-pane", args: "" } as never);
  await settle();
  const pane = await $.ui.mount({ plugin: "chitas", surface: "terminal", component: "Pane", requestId: "chitas", props: PROPS as never });
  expect(await pane.find({ key: "tab-hayom" })).toBeUndefined();
  expect(JSON.stringify(await pane.drawn())).not.toContain("hayom yom text");
  const band = await $.ui.mount({ plugin: "chitas", surface: "terminal", component: "AbovePrompt", props: {} as never });
  await settle();
  expect(await band.find({ key: "row-Hayom Yom" })).toBeUndefined();
  expect(await band.find({ key: "row-Tanya" })).toBeDefined();
});

test("Rambam halachot are numbered in bold, restarting each chapter", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "chitas-pane", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "chitas", surface: "desktop", component: "Pane", requestId: "chitas", props: PROPS as never });
  await ui.press({ key: "tab-rambam3" } as never);
  const read = async () => {
    const texts = await ui.findAll({ type: "Text" });
    return {
      headings: texts.map((t) => t.text.replace(/\u200F/g, "").trim()).filter((x) => x.startsWith("פרק")),
      labels: texts.filter((t) => t.props.bold && /^[\u05D0-\u05EA]+\.$/.test(t.text.replace(/\u200F/g, "").trim())).map((t) => t.text.replace(/\u200F/g, "").trim()),
      all: texts.map((t) => t.text).join("\n"),
    };
  };
  // Rambam ×3 today is chapters 12-14, shown one perek at a time.
  let r = await read();
  expect(r.headings).toEqual(["פרק יב"]);
  expect(r.all).toContain("perek 1 of 3");
  expect(r.labels.slice(0, 3)).toEqual(["א.", "ב.", "ג."]);
  expect(r.labels).toContain("טו.");
  expect(r.labels.length).toBe(22);
  expect(await ui.find({ key: "perek-prev-end" })).toBeUndefined();

  await ui.press({ key: "perek-next-end" } as never);
  r = await read();
  expect(r.headings).toEqual(["פרק יג"]);
  expect(r.all).toContain("perek 2 of 3");
  expect(r.labels[0]).toBe("א."); // numbering restarts each perek
  expect(r.labels.length).toBe(27);

  await ui.press({ key: "perek-next-top" } as never);
  r = await read();
  expect(r.headings).toEqual(["פרק יד"]);
  expect(r.all).toContain("done ✓");
  expect(await ui.find({ key: "perek-next-end" })).toBeUndefined();

  await ui.press({ key: "perek-prev-end" } as never);
  expect((await read()).headings).toEqual(["פרק יג"]);

  // Rambam ×1 is a single perek: no perek buttons.
  await ui.press({ key: "tab-rambam1" } as never);
  expect(await ui.find({ key: "perek-next-end" })).toBeUndefined();
  expect((await read()).headings).toEqual(["פרק ב"]);
});

test("Tanya shows the whole day's portion", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "chitas-pane", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "chitas", surface: "desktop", component: "Pane", requestId: "chitas", props: PROPS as never });
  await ui.press({ key: "tab-tanya" } as never);
  const t = (await ui.findAll({ type: "Text" })).map((x) => x.text).join("\n");
  expect(t).toContain("Tanya · 25 Tishrei (Iggeret HaKodesh 25:1-5)");
  const bare = t.replace(/[\u0591-\u05C7\u200F]/g, "");
  expect(bare).toContain("צוואת ריב"); // paragraph 1
  expect(bare).toContain("וזהו ״כי ה׳ אמר לו״"); // paragraph 5, the last of the day
});

for (const [choice, flag] of [["Shlomo SemiStam", undefined], ["Terminal default", "--remove"]] as const) {
  test(`Hebrew font setting "${choice}" runs the font script at session start`, { timeoutMs: 20000, options: { hebrew_font: choice } }, async ($, on) => {
    const runs: string[][] = [];
    const toasts: string[] = [];
    host(on, (argv) => {
      runs.push(argv);
      const stdout = flag ? "" : "changed: installed Shlomo SemiStam (Ezra SIL SR) to ~/Library/Fonts\n";
      return { exitCode: 0, stdout, stderr: "" };
    });
    on("ui.toast", async (_$, e: any) => { toasts.push(String(e.text ?? e)); return { value: undefined } as never; });
    on("session.start", async () => ({ cwd: "/tmp" }) as never);
    await $.session.start({ cwd: "/tmp" } as never);
    await settle();
    expect(runs.length).toBe(1);
    expect(runs[0]![2]).toBe(flag);
    expect(toasts.some((t) => t.includes("cmd+shift+,"))).toBe(!flag);
  });
}

for (const [term, reversed] of [["ghostty", true], ["Apple_Terminal", false]] as const) {
  test(`Hebrew is ${reversed ? "reversed" : "kept in reading order"} in ${term}`, { timeoutMs: 20000 }, async ($, on) => {
    host(on, undefined, term);
    await $.command.run({ command: "chitas-pane", args: "" } as never);
    await settle();
    const ui = await $.ui.mount({ plugin: "chitas", surface: "terminal", component: "Pane", requestId: "chitas", props: PROPS as never });
    const texts = (await ui.findAll({ type: "Text" })).map((t) => t.text.replace(/[֑-ׇ‎]/g, ""));
    // Genesis 2:20 opens ויקרא; reversed for Ghostty it reads ארקיו from the left.
    expect(texts.some((t) => t.includes(reversed ? "ארקיו" : "ויקרא"))).toBe(true);
    expect(texts.some((t) => t.includes(reversed ? "ויקרא" : "ארקיו"))).toBe(false);
  });
}

test("Mac Terminal: words go right to left, letters as written, edge punctuation moved", { timeoutMs: 20000 }, async ($, on) => {
  host(on, undefined, "Apple_Terminal");
  await $.command.run({ command: "chitas-pane", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "chitas", surface: "terminal", component: "Pane", requestId: "chitas", props: PROPS as never });
  await ui.press({ key: "tab-rambam3" } as never);
  const texts = await ui.findAll({ type: "Text" });
  const bare = (x: string) => x.replace(/[\u0591-\u05C7\u200F]/g, "");
  // Terminal.app draws LRM/RLM/overrides as visible boxes: none may be sent.
  expect(texts.some((t) => /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(t.text))).toBe(false);
  // Labels: the period sent before the letter, so it shows on the letter's left.
  const labels = texts.filter((t) => t.props.bold && /^\.[\u05D0-\u05EA]+$/.test(t.text)).map((t) => t.text);
  expect(labels.slice(0, 2)).toEqual([".\u05D0", ".\u05D1"]);
  // Halacha 12:1 opens "החופר בור ברשות הרבים": sent last word first, so
  // the line's last word is החופר, spelled as written.
  const first = texts.find((t) => bare(t.text).trim().endsWith("ברשות בור החופר"));
  expect(first).toBeDefined();
  // Sentence punctuation ends a word, so it is sent at the word's start; and a
  // bracket that opened a word is sent mirrored at its end ("(שמות" → "שמות)").
  const words = texts.flatMap((t) => t.text.split(" ")).filter((w) => /[\u05D0-\u05EA]/.test(w));
  expect(words.filter((w) => /[.,;:!?]$/.test(bare(w)))).toEqual([]);
  expect(words.some((w) => /^[.,;:]/.test(w))).toBe(true);
  expect(words).toContain("שמות)");
});

test("each letter's dagesh and shin dot come before its vowel", { timeoutMs: 20000 }, async ($, on) => {
  host(on, undefined, "Apple_Terminal"); // reading order, so words can be found as written
  await $.command.run({ command: "chitas-pane", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "chitas", surface: "terminal", component: "Pane", requestId: "chitas", props: PROPS as never });
  await ui.press({ key: "tab-tehillim" } as never);
  const t = (await ui.findAll({ type: "Text" })).map((x) => x.text).join("\n");
  // Psalm 119:1 בְּתוֹרַת: bet, dagesh, sheva (Sefaria has bet, sheva, dagesh).
  expect(t).toContain("בְּתוֹרַת");
  expect(t).not.toContain("בְּ");
  // אַשְׁרֵי: shin, shin dot, sheva.
  expect(t).toContain("שְׁ");
});

test("Desktop: Hebrew wrapped and right-aligned, in reading order inside right-to-left marks", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "chitas-pane", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "chitas", surface: "desktop", component: "Pane", requestId: "chitas", props: PROPS as never });
  await ui.press({ key: "tab-rambam3" } as never);
  const texts = await ui.findAll({ type: "Text" });
  const label = texts.find((t) => t.props.bold && t.text.replace(/‏/g, "") === "א.");
  expect(label?.text).toBe("‏א.‏");
  // 12:1 opens "החופר בור": in reading order, not reversed.
  const bare = (x: string) => x.replace(/[֑-ׇ‏]/g, "");
  expect(texts.some((t) => bare(t.text).startsWith("החופר בור ברשות"))).toBe(true);
  expect(await ui.find({ key: "flip" })).toBeUndefined();
  // The Hebrew date in the header, in reading order: כ״ה בתשרי תשפ״ז
  expect(texts.some((t) => bare(t.text) === "\u05DB\u05F4\u05D4 \u05D1\u05EA\u05E9\u05E8\u05D9 \u05EA\u05E9\u05E4\u05F4\u05D6")).toBe(true);
});

test("band is one line of section buttons, and × hides it for the day", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  // What the engine draws when the mod passes the band on: nothing.
  on("ui.render", { component: "AbovePrompt" }, async () => ({ type: "Box", props: {}, children: [] }) as never);
  const band = await $.ui.mount({ plugin: "chitas", surface: "desktop", component: "AbovePrompt", props: {} as never });
  await settle();
  const drawn = await band.drawn();
  expect((drawn as { props?: { flexDirection?: string } }).props?.flexDirection).toBe("row");
  expect((await band.find({ key: "row-Tanya" }))?.text).toBe("Tanya");
  expect(await band.find({ key: "dismiss" })).toBeDefined();

  await band.press({ key: "dismiss" } as never);
  expect(await band.find({ key: "row-Tanya" })).toBeUndefined();

  await $.command.run({ command: "chitas-toggle", args: "" } as never);
  expect(await band.find({ key: "row-Tanya" })).toBeDefined();
});
