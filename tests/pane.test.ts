import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import fixture from "./fixture-day";

const PROPS = {
  title: "Daily Learning", isFocused: true, bodyColumns: 60, placement: "dock" as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
};
// The test environment has timers; its type library doesn't declare them.
declare const setTimeout: (fn: (v?: unknown) => void, ms: number) => unknown;
const settle = () => new Promise((r) => setTimeout(r, 500));

// What the engine does beneath the mod: the script, the store, the pane, the band's fetches.
const configSets: { key: string; value: unknown }[] = [];
let configRows = true; // false: a build whose /config lists no plugin rows (the Desktop app's)
function host(on: On, script?: (argv: string[]) => { exitCode: number; stdout: string; stderr: string }, term = "ghostty", font?: string) {
  configSets.length = 0;
  on("config.set", async (_$, e: any) => { configSets.push({ key: e.key, value: e.value }); return { value: e.value } as never; });
  // The rows as the Desktop app names them: <plugin>@<marketplace>.<field>.
  on("config.list", async () => ({ value: (configRows ? ["hebrew_font", "english", "nikkud", "rashi", "text_size"] : []).map((f) => ({
    key: `dl@daily-learning.${f}`, label: f, kind: "choice", value: "", provider: { plugin: "dl@daily-learning", tier: "user" }, isLocked: false,
  })) }) as never);
  if (font) on("fs.read", async () => ({ value: { base64: font } }) as never);
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

// Open one of today's sections the way a reader does: 📅 Today, then the
// section in the day's menu.
async function openTab(ui: { find: (q: { key: string }) => Promise<unknown>; press: (t: never) => Promise<unknown> }, id: string) {
  if (!(await ui.find({ key: `tab-${id}` }))) {
    await ui.press({ key: "today" } as never);
    if (await ui.find({ key: "crumb-today" })) await ui.press({ key: "crumb-today" } as never);
  }
  await ui.press({ key: `tab-${id}` } as never);
}

test("pane shows the Chumash text after /dl", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({ plugin: "dl", surface, component: "Pane", requestId: "dl", props: PROPS as never });
    await openTab(ui, "chumash");
    expect(JSON.stringify(await ui.drawn())).toContain("Bereshit");
    for (const tab of ["chumash", "tehillim", "tanya", "rambam1", "rambam3"]) {
      await openTab(ui, tab);
      const text = (await ui.findAll({ type: "Text" })).map((t) => t.text).join("\n");
      expect(text.length).toBeLessThan(100_000);
      expect(text).not.toContain("&thinsp;");
    }
    await openTab(ui, "chumash");
  }
});

test("pane loads its text by itself when drawn", { timeoutMs: 20000 }, async ($, on) => {
  const { clock } = host(on);
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  await clock.advance(1);
  await settle();
  await openTab(ui, "chumash");
  expect(JSON.stringify(await ui.drawn())).toContain("Bereshit");
});

test("the band's 📅 Today's learning opens the day's menu", { timeoutMs: 20000 }, async ($, on) => {
  const { opened } = host(on);
  const band = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "AbovePrompt", props: {} as never });
  await settle();
  await band.press({ key: "band-today" } as never);
  expect(opened).toContain("dl");
  await settle();
  const pane = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  expect(await pane.find({ key: "tab-tanya" })).toBeDefined();
  expect(JSON.stringify(await pane.drawn())).toContain("Tanya · 25 Tishrei");
});

test("Chumash shows each verse's Rashi under it; English is a toggle", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "desktop", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
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
  // English is a setting: the settings page writes it, which reloads the mod with it.
  await ui.press({ key: "settings" } as never);
  await ui.press({ key: "set-english-staggered" } as never);
  expect(configSets).toContainEqual({ key: "dl@daily-learning.english", value: "Staggered" });
});

test("English staggered: each verse, then its English, then Rashi and Rashi's English", { timeoutMs: 20000, options: { english: "Staggered" } }, async ($, on) => {
  host(on, undefined, "Apple_Terminal");
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "desktop", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  const bare = (x: string) => x.replace(/[\u0591-\u05C7\u200F]/g, "");
  const t = (await ui.findAll({ type: "Text" })).map((x) => x.text);
  const v21 = t.findIndex((x) => bare(x).startsWith("ויפל"));
  const sleep = t.findIndex((x) => x.includes("deep sleep"));
  const r21 = t.findIndex((x) => bare(x).startsWith("מצלעותיו"));
  const ribs = t.findIndex((x) => x.includes("OF HIS RIBS"));
  expect(v21).toBeGreaterThan(-1);
  expect(sleep).toBeGreaterThan(v21);
  expect(r21).toBeGreaterThan(sleep);
  expect(ribs).toBeGreaterThan(r21);
  expect(ribs).toBeLessThan(t.findIndex((x) => bare(x).startsWith("ויבן")));
});

test("English side by side: English in the left half, Hebrew in the right", { timeoutMs: 20000, options: { english: "Side by side" } }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  const drawn = JSON.stringify(await ui.drawn());
  expect(drawn).toContain("deep sleep");
  // A pair is a row of two half-width columns: English first, Hebrew second.
  const rows = (await ui.findAll({ type: "Box" })).filter((b) => b.props.flexDirection === "row" && b.props.justifyContent === "space-between" && JSON.stringify(b.children).includes("deep sleep"));
  // (The verse, and Rashi on it, whose English says "deep sleep" too.)
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const [left, right] = row.children as { props: { width: number } }[];
    expect(left!.props.width).toBe(right!.props.width);
    expect(JSON.stringify(left)).toContain("deep sleep");
    expect(JSON.stringify(right)).not.toContain("deep sleep");
  }
});

test("Rambam ×3 has its text", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "desktop", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  await openTab(ui, "rambam3");
  const t = (await ui.findAll({ type: "Text" })).map((x) => x.text).join("\n");
  expect(t).toContain("Rambam ×3");
  expect(t).not.toContain("Rambam ×1");
  expect(t).not.toContain("No text from Sefaria");
});

test("Hayom Yom is left out when its text did not load", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const pane = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(pane, "chumash");
  expect(await pane.find({ key: "tab-hayom" })).toBeUndefined();
  expect(JSON.stringify(await pane.drawn())).not.toContain("hayom yom text");
});

test("Rambam halachot are numbered in bold, restarting each chapter", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "desktop", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  await openTab(ui, "rambam3");
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
  expect(await ui.find({ key: "prev-end" })).toBeUndefined();

  await ui.press({ key: "next-end" } as never);
  r = await read();
  expect(r.headings).toEqual(["פרק יג"]);
  expect(r.all).toContain("perek 2 of 3");
  expect(r.labels[0]).toBe("א."); // numbering restarts each perek
  expect(r.labels.length).toBe(27);

  await ui.press({ key: "next-top" } as never);
  r = await read();
  expect(r.headings).toEqual(["פרק יד"]);
  expect(r.all).toContain("done ✓");
  expect(await ui.find({ key: "next-end" })).toBeUndefined();

  await ui.press({ key: "prev-end" } as never);
  expect((await read()).headings).toEqual(["פרק יג"]);

  // Rambam ×1 is a single perek: no perek buttons.
  await openTab(ui, "rambam1");
  expect(await ui.find({ key: "next-end" })).toBeUndefined();
  expect((await read()).headings).toEqual(["פרק ב"]);
});

test("Tanya shows the whole day's portion", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "desktop", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  await openTab(ui, "tanya");
  const t = (await ui.findAll({ type: "Text" })).map((x) => x.text).join("\n");
  expect(t).toContain("Tanya · 25 Tishrei (Iggeret HaKodesh 25:1-5)");
  const bare = t.replace(/[\u0591-\u05C7\u200F]/g, "");
  expect(bare).toContain("צוואת ריב"); // paragraph 1
  expect(bare).toContain("וזהו ״כי ה׳ אמר לו״"); // paragraph 5, the last of the day
});

for (const [choice, arg] of [["Shlomo", "Shlomo"], ["Frank Ruhl", "FrankRuhlLibre-Regular"], ["System", "--remove"]] as const) {
  test(`Hebrew font setting "${choice}" runs the font script at session start`, { timeoutMs: 20000, options: { hebrew_font: choice } }, async ($, on) => {
    const runs: string[][] = [];
    const toasts: string[] = [];
    host(on, (argv) => {
      runs.push(argv);
      const stdout = arg === "--remove" ? "" : "changed: installed it to ~/Library/Fonts\n";
      return { exitCode: 0, stdout, stderr: "" };
    });
    on("ui.toast", async (_$, e: any) => { toasts.push(String(e.text ?? e)); return { value: undefined } as never; });
    on("session.start", async () => ({ cwd: "/tmp" }) as never);
    await $.session.start({ cwd: "/tmp" } as never);
    await settle();
    expect(runs.length).toBe(1);
    expect(runs[0]![2]).toBe(arg);
    expect(toasts.some((t) => t.includes("cmd+shift+,"))).toBe(arg !== "--remove");
  });
}

for (const [term, reversed] of [["ghostty", true], ["Apple_Terminal", false]] as const) {
  test(`Hebrew is ${reversed ? "reversed" : "kept in reading order"} in ${term}`, { timeoutMs: 20000 }, async ($, on) => {
    host(on, undefined, term);
    await $.command.run({ command: "dl", args: "" } as never);
    await settle();
    const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
    await openTab(ui, "chumash");
    const texts = (await ui.findAll({ type: "Text" })).map((t) => t.text.replace(/[֑-ׇ‎]/g, ""));
    // Genesis 2:20 opens ויקרא; reversed for Ghostty it reads ארקיו from the left.
    expect(texts.some((t) => t.includes(reversed ? "ארקיו" : "ויקרא"))).toBe(true);
    expect(texts.some((t) => t.includes(reversed ? "ויקרא" : "ארקיו"))).toBe(false);
  });
}

test("Mac Terminal: words go right to left, letters as written, edge punctuation moved", { timeoutMs: 20000 }, async ($, on) => {
  host(on, undefined, "Apple_Terminal");
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  await openTab(ui, "rambam3");
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
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  await openTab(ui, "tehillim");
  const t = (await ui.findAll({ type: "Text" })).map((x) => x.text).join("\n");
  // Psalm 119:1 בְּתוֹרַת: bet, dagesh, sheva (Sefaria has bet, sheva, dagesh).
  expect(t).toContain("בְּתוֹרַת");
  expect(t).not.toContain("בְּ");
  // אַשְׁרֵי: shin, shin dot, sheva.
  expect(t).toContain("שְׁ");
});

test("Desktop: Hebrew wrapped and right-aligned, in reading order inside right-to-left marks", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "desktop", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  await openTab(ui, "rambam3");
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

test("band is one line: the date, Today's learning, the Library; × hides it for the day", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  // What the engine draws when the mod passes the band on: nothing.
  on("ui.render", { component: "AbovePrompt" }, async () => ({ type: "Box", props: {}, children: [] }) as never);
  const band = await $.ui.mount({ plugin: "dl", surface: "desktop", component: "AbovePrompt", props: {} as never });
  await settle();
  const drawn = await band.drawn();
  expect((drawn as { props?: { flexDirection?: string } }).props?.flexDirection).toBe("row");
  expect((await band.find({ key: "band-today" }))?.text).toBe("📅 Today's learning");
  expect((await band.find({ key: "band-library" }))?.text).toBe("📚 Library");
  expect(await band.find({ key: "row-Tanya" })).toBeUndefined(); // no list of the day's sections
  expect(await band.find({ key: "dismiss" })).toBeDefined();

  await band.press({ key: "dismiss" } as never);
  expect(await band.find({ key: "band-today" })).toBeUndefined();

  await $.command.run({ command: "dl-toggle", args: "" } as never);
  expect(await band.find({ key: "band-today" })).toBeDefined();
});

test("Daf Yomi: one amud at a time, each passage with its Rashi, English on the toggle", { timeoutMs: 20000 }, async ($, on) => {
  host(on, undefined, "Apple_Terminal"); // reading order, so text can be matched as written
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  await openTab(ui, "daf");
  const bare = (x: string) => x.replace(/[\u0591-\u05C7]/g, "");
  const texts = async () => (await ui.findAll({ type: "Text" })).map((t) => bare(t.text));
  let t = await texts();
  expect(t.join("\n")).toContain("Daf Yomi · Bekhorot 18");
  // Heading דף יח. (sent for macOS Terminal as ".יח דף") and the amud counter.
  expect(t.some((x) => x.includes(".\u05D9\u05D7") && x.includes("\u05D3\u05E3"))).toBe(true);
  expect(t.join("\n")).toContain("amud 1 of 2");
  // Rashi on the first passage: "סבר לה כר' יוסי הגלילי" (words reversed for the terminal).
  const rashi = (await ui.findAll({ type: "Text" })).filter((x) => x.props.color === "permission");
  expect(rashi.length).toBeGreaterThan(5);
  expect(t.some((x) => x.includes("Rabbi Yosei HaGelili"))).toBe(false);
  await ui.press({ key: "next-end" } as never);
  t = await texts();
  expect(t.join("\n")).toContain("amud 2 of 2");
  expect(t.some((x) => x.includes(":\u05D9\u05D7") && x.includes("\u05D3\u05E3"))).toBe(true);
});

test("Desktop: the body is one SVG with the chosen font embedded, Hebrew in reading order", { timeoutMs: 20000, options: { hebrew_font: "Frank Ruhl" } }, async ($, on) => {
  host(on, undefined, "ghostty", "d09GRgABAAA=");
  on("session.start", async () => ({ cwd: "/tmp" }) as never);
  await $.session.start({ cwd: "/tmp" } as never);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "desktop", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  await openTab(ui, "rambam3");
  const svgs = await ui.findAll({ type: "Svg" });
  expect(svgs.length).toBe(1);
  const src = String(svgs[0]!.props.source);
  expect(src).toContain("data:font/woff;base64,d09GRgABAAA=");
  expect(src.length).toBeLessThanOrEqual(131072);
  expect(src).toContain("direction:rtl");
  expect(src).toContain('<tspan class="b">\u05D0.</tspan>'); // halacha א. in bold
  expect(src.replace(/[\u0591-\u05C7]/g, "")).toContain("\u05D4\u05D7\u05D5\u05E4\u05E8 \u05D1\u05D5\u05E8"); // החופר בור, as written
  // Tabs and perek buttons stay outside the picture.
  expect(await ui.find({ key: "next-end" })).toBeDefined();
});

test("terminal: the header stays at the top of the window as the sidebar scrolls", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const scrolled = { ...PROPS, scroll: { offset: 12, bodyRows: 40 } };
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: scrolled as never });
  await openTab(ui, "chumash");
  const header = await ui.find({ key: "header" });
  expect(header?.props.position).toBe("absolute");
  expect(header?.props.top).toBe(12);
  expect((await ui.find({ key: "blank" }))?.props.top).toBe(12);
  await openTab(ui, "tanya");
  expect(JSON.stringify(await ui.drawn())).toContain("Tanya · 25 Tishrei");
});

test("Daf Yomi with English: each passage's English under it", { timeoutMs: 20000, options: { english: "Staggered" } }, async ($, on) => {
  host(on, undefined, "Apple_Terminal");
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  await openTab(ui, "daf");
  const t = (await ui.findAll({ type: "Text" })).map((x) => x.text);
  expect(t.some((x) => x.includes("Rabbi Yosei HaGelili"))).toBe(true);
});

test("settings page: rows of choices that write the plugin's settings", { timeoutMs: 20000, options: { hebrew_font: "Shlomo", rashi: false } }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  await ui.press({ key: "settings" } as never);
  // The current values are marked.
  expect((await ui.find({ key: "set-hebrew_font-shlomo" }))?.props.variant).toBe("primary");
  expect((await ui.find({ key: "set-rashi-off" }))?.props.variant).toBe("primary");
  expect((await ui.find({ key: "set-english-off" }))?.props.variant).toBe("primary");
  await ui.press({ key: "set-english-side-by-side" } as never);
  await ui.press({ key: "set-hebrew_font-frank-ruhl" } as never);
  await ui.press({ key: "set-nikkud-off" } as never);
  expect(configSets).toEqual([
    { key: "dl@daily-learning.english", value: "Side by side" },
    { key: "dl@daily-learning.hebrew_font", value: "Frank Ruhl" },
    { key: "dl@daily-learning.nikkud", value: false },
  ]);
  // A tab goes back to the text.
  await openTab(ui, "tanya");
  expect(await ui.find({ key: "set-english-off" })).toBeUndefined();
  expect(JSON.stringify(await ui.drawn())).toContain("Tanya · 25 Tishrei");
});

test("rashi off: the Chumash shows no Rashi", { timeoutMs: 20000, options: { rashi: false } }, async ($, on) => {
  host(on, undefined, "Apple_Terminal");
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  await openTab(ui, "chumash");
  const rashi = (await ui.findAll({ type: "Text" })).filter((x) => x.props.color === "permission");
  expect(rashi.length).toBe(0);
});

test("Today is a menu: each section with what it is today; inside, back and on through the day", { timeoutMs: 20000 }, async ($, on) => {
  host(on);
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  // The menu: today's sections, Hayom Yom left out (no text today), each with its reading.
  for (const id of ["chumash", "tehillim", "tanya", "rambam1", "rambam3", "daf"]) expect(await ui.find({ key: `tab-${id}` })).toBeDefined();
  expect(await ui.find({ key: "tab-hayom" })).toBeUndefined();
  expect(JSON.stringify(await ui.drawn())).toContain("Tanya · 25 Tishrei (Iggeret HaKodesh 25:1-5)");
  // No English or nikkud buttons in the header: those are settings now.
  expect(await ui.find({ key: "english" })).toBeUndefined();
  expect(await ui.find({ key: "nikkud" })).toBeUndefined();
  await ui.press({ key: "tab-tehillim" } as never);
  expect((await ui.find({ key: "day-next" }))?.text).toContain("Tanya");
  expect((await ui.find({ key: "day-prev" }))?.text).toContain("Chumash");
  await ui.press({ key: "day-next" } as never);
  expect(JSON.stringify(await ui.drawn())).toContain("Iggeret HaKodesh 25:1-5");
  await ui.press({ key: "crumb-today" } as never);
  expect(await ui.find({ key: "tab-chumash" })).toBeDefined();
  // The last section's "next" goes back to the menu.
  await ui.press({ key: "tab-daf" } as never);
  expect(await ui.find({ key: "day-done" })).toBeDefined();
});

test("settings page where /config lists no plugin rows (Desktop): the choice applies at once and is kept", { timeoutMs: 20000 }, async ($, on) => {
  configRows = false;
  const toasts: string[] = [];
  host(on);
  on("ui.toast", async (_$, e: any) => { toasts.push(String(e.text ?? e)); return { value: undefined } as never; });
  try {
    await $.command.run({ command: "dl", args: "" } as never);
    await settle();
    const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
    await ui.press({ key: "settings" } as never);
    await ui.press({ key: "set-english-side-by-side" } as never);
    // Marked as chosen right away, no /config write, no error.
    expect((await ui.find({ key: "set-english-side-by-side" }))?.props.variant).toBe("primary");
    expect(configSets).toEqual([]);
    expect(toasts).toEqual([]);
    // And the text shows it: English beside the Hebrew.
    await openTab(ui, "chumash");
    const pairs = (await ui.findAll({ type: "Box" })).filter((b) => b.props.flexDirection === "row" && b.props.justifyContent === "space-between" && JSON.stringify(b.children).includes("deep sleep"));
    expect(pairs.length).toBeGreaterThan(0);
  } finally {
    configRows = true;
  }
});
