import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import fixture from "./fixture-day";

const PROPS = {
  title: "Chitas", isFocused: true, bodyColumns: 60, placement: "dock" as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
};
const settle = () => new Promise((r) => setTimeout(r, 500));

// What the engine does beneath the mod: the script, the store, the pane, the band's fetches.
function host(on: On) {
  const store = new Map<string, unknown>();
  const opened: string[] = [];
  on("process.run", async () => ({ value: { exitCode: 0, stdout: JSON.stringify(fixture), stderr: "" } }) as never);
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
    for (const tab of ["chumash", "rashi", "tehillim", "tanya", "rambam", "hayom"]) {
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
