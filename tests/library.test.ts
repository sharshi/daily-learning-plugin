import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";

import { books, findBook, libPart, parseShape, step, textRef, unitName } from "../hooks/library";
import fixture from "./fixture-library";
import day from "./fixture-day";

declare const setTimeout: (fn: (v?: unknown) => void, ms: number) => unknown;
const settle = () => new Promise((r) => setTimeout(r, 300));
const bare = (x: string) => x.replace(/[֑-ׇ‏]/g, "");
const F = fixture as any;

test("parseShape: sections of books; a Bavli book's dapim come from its amudim", () => {
  const m = parseShape("mishnah", F.shapes["Mishnah"]);
  expect(m.sections.map((s) => s.name)).toEqual(["Seder Zeraim", "Seder Moed"]);
  expect(findBook(m, "Mishnah Berakhot")).toMatchObject({ name: "Berakhot", he: "ברכות", first: 1, last: 9 });
  const b = parseShape("bavli", F.shapes["Bavli"]);
  expect(findBook(b, "Berakhot")).toMatchObject({ first: 2, last: 64 });
  expect(findBook(b, "Tamid")).toMatchObject({ first: 25, last: 33 }); // Tamid starts on 25b
  const mt = parseShape("mt", F.shapes["Halakhah/Mishneh Torah"]);
  expect(books(mt).map((x) => x.name)).toEqual(["Foundations of the Torah", "Human Dispositions"]); // Steinsaltz skipped
  expect(mt.sections[0]!.he).toBe("ספר המדע");
});

test("step crosses books: after Berakhot 9 comes Peah 1, and back", () => {
  const m = parseShape("mishnah", F.shapes["Mishnah"]);
  expect(step(m, "Mishnah Berakhot", 9, 1)).toMatchObject({ book: { title: "Mishnah Peah" }, unit: 1 });
  expect(step(m, "Mishnah Peah", 1, -1)).toMatchObject({ book: { title: "Mishnah Berakhot" }, unit: 9 });
  expect(step(m, "Mishnah Berakhot", 1, -1)).toBe(null); // the first perek of the collection
  expect(unitName("bavli", 64)).toBe("דף סד");
});

test("libPart: a daf as its amudim with Rashi per passage; a one-amud daf as one", () => {
  const b = parseShape("bavli", F.shapes["Bavli"]);
  const ber = findBook(b, "Berakhot")!;
  const two = libPart("bavli", ber, 2, F.texts["Berakhot 2"], F.texts["Rashi on Berakhot 2"]);
  expect(two.sections!.map((s) => s.short)).toEqual(["ב.", "ב:"]);
  // Rashi per passage; Sefaria leaves the list short when the last passages have none.
  expect(two.sections![0]!.rashi!.length).toBeGreaterThan(0);
  expect(two.sections![0]!.rashi!.length).toBeLessThanOrEqual(two.sections![0]!.he.length);
  const one = libPart("bavli", ber, 64, F.texts["Berakhot 64"], F.texts["Rashi on Berakhot 64"]);
  expect(one.sections!.map((s) => s.name)).toEqual(["ברכות דף סד."]);
  expect(one.sections![0]!.rashi!.length).toBe(15);
  const m = parseShape("mishnah", F.shapes["Mishnah"]);
  const p = libPart("mishnah", findBook(m, "Mishnah Berakhot")!, 9, F.texts["Mishnah Berakhot 9"]);
  expect(p.numbered).toBe(true);
  expect(p.sections![0]!.name).toBe("ברכות פרק ט");
  expect(textRef(findBook(m, "Mishnah Berakhot")!, 9)).toBe("Mishnah Berakhot 9");
});

// The engine beneath the mod: Sefaria from the fixture, a store in memory.
function host(on: On) {
  const store = new Map<string, unknown>();
  const fetched: string[] = [];
  on("store.get", async (_$, e: any) => ({ value: store.get(e.key) }) as never);
  on("store.set", async (_$, e: any) => { store.set(e.key, e.value); return { value: undefined } as never; });
  on("store.keys", async () => ({ value: [...store.keys()] }) as never);
  on("store.delete", async (_$, e: any) => { store.delete(e.key); return { value: undefined } as never; });
  on("ui.open", async () => ({ value: { isPlaced: true } }) as never);
  on("env.get", async () => ({ value: "Apple_Terminal" }) as never); // reading order: text matches as written
  on("process.run", async () => ({ value: { exitCode: 0, stdout: JSON.stringify(day), stderr: "" } }) as never);
  on("http.fetch", async (_$, e: any) => {
    const url = decodeURIComponent(String(e.url));
    fetched.push(url);
    const m = /\/api\/shape\/(.+)$/.exec(url) ?? /\/api\/v3\/texts\/([^?]+)/.exec(url);
    const body = url.includes("/api/shape/") ? F.shapes[m![1]!] : F.texts[m![1]!];
    return { value: body ? { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } : { status: 404, ok: false, headers: {}, text: "" } } as never;
  });
  return { fetched, clock: mock.clock(on) };
}
const PROPS = { title: "Daily Learning", isFocused: true, bodyColumns: 70, placement: "dock", scroll: { offset: 0, bodyRows: 40 }, view: {} };

test("Library: menu down to a perek, loaded only as opened, next crosses masechtos, Continue returns", { timeoutMs: 30000 }, async ($, on) => {
  const { fetched, clock } = host(on);
  const tick = async () => { await clock.advance(1); await settle(); };
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  const texts = async () => (await ui.findAll({ type: "Text" })).map((t) => bare(t.text));

  await ui.press({ key: "library" } as never);
  expect(await ui.find({ key: "open-mishnah" })).toBeDefined();
  expect(fetched.filter((u) => u.includes("sefaria"))).toEqual([]); // nothing until a collection opens

  await ui.press({ key: "open-mishnah" } as never);
  await tick();
  expect(fetched.filter((u) => u.includes("/shape/"))).toEqual(["https://www.sefaria.org/api/shape/Mishnah"]);
  await ui.press({ key: "section-Seder-Zeraim" } as never);
  await ui.press({ key: "book-Mishnah-Berakhot" } as never);
  expect(await ui.find({ key: "unit-9" })).toBeDefined();
  expect(await ui.find({ key: "unit-10" })).toBeUndefined();

  await ui.press({ key: "unit-9" } as never);
  await tick();
  let t = await texts();
  expect(t.some((x) => x.includes("Mishnayos · Berakhot 9"))).toBe(true);
  expect(t.some((x) => x.includes(".א"))).toBe(true); // mishnah א. (sent for macOS Terminal as ".א")
  expect(fetched.filter((u) => u.includes("/v3/texts/"))).toHaveLength(1);

  // Next from the last perek of Berakhot is Peah 1.
  await ui.press({ key: "lib-next-end" } as never);
  await tick();
  t = await texts();
  expect(t.some((x) => x.includes("Mishnayos · Peah 1"))).toBe(true);
  expect((await ui.find({ key: "crumb-book" }))?.text).toBe("Peah");

  // Back to the top: Continue offers where Mishnayos was left.
  await ui.press({ key: "crumb-library" } as never);
  expect((await ui.find({ key: "continue-mishnah" }))?.text).toBe("Continue Peah 1");
  await ui.press({ key: "continue-mishnah" } as never);
  await tick();
  expect((await texts()).some((x) => x.includes("Mishnayos · Peah 1"))).toBe(true);
  // Peah 1 came from the cache the second time.
  expect(fetched.filter((u) => u.includes("Mishnah Peah 1"))).toHaveLength(1);
});

test("Library: a daf shows both amudim, each passage with its Rashi", { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = host(on);
  const tick = async () => { await clock.advance(1); await settle(); };
  await $.command.run({ command: "dl", args: "" } as never);
  await settle();
  const ui = await $.ui.mount({ plugin: "dl", surface: "terminal", component: "Pane", requestId: "dl", props: PROPS as never });
  await ui.press({ key: "library" } as never);
  await ui.press({ key: "open-bavli" } as never);
  await tick();
  await ui.press({ key: "section-Seder-Zeraim" } as never);
  await ui.press({ key: "book-Berakhot" } as never);
  await ui.press({ key: "unit-2" } as never);
  await tick();
  const t = (await ui.findAll({ type: "Text" }));
  const shown = t.map((x) => bare(x.text));
  expect(shown.some((x) => x.includes("Shas · Berakhot 2"))).toBe(true);
  // Headings ברכות דף ב. and ברכות דף ב: (word order for macOS Terminal).
  expect(shown.some((x) => x.includes(".ב") && x.includes("דף"))).toBe(true);
  expect(shown.some((x) => x.includes(":ב") && x.includes("דף"))).toBe(true);
  expect(t.filter((x) => x.props.color === "magenta").length).toBeGreaterThan(0); // Rashi
});
