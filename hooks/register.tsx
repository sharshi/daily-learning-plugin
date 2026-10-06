// dl (Daily Learning): today's learning in a band above the prompt, and the full text in a
// sidebar (/dl). Both are cached per Gregorian day, in memory and in
// the mod's $.store. Data: ./data.ts; Hebrew layout: ./hebrew.ts.

import { atom, read, update } from "claude-code";
import type { EngineInterface as Host, Register, RenderChildren } from "claude-code";

import type { Day, Status, TabId } from "../types";
import { briefFrom, calendarUrl, DAY_V, hebcalUrl, hebrewDate, linesFor, todayKey, toDay } from "./data";
import type { English } from "./data";
import type { Brief } from "./data";
import { cleanHe, cleanText, termVisual, visual, wrap } from "./hebrew";
import { svgPages } from "./svg";
import type { EmbeddedFont, FontKey, Line } from "./svg";

const PANE = "dl";
const TABS: [TabId, string][] = [
  ["chumash", "Chumash + Rashi"], ["tehillim", "Tehillim"],
  ["tanya", "Tanya"], ["rambam1", "Rambam ×1"], ["rambam3", "Rambam ×3"], ["hayom", "Hayom Yom"],
  ["daf", "Daf Yomi"],
];


// ---- pane state ---------------------------------------------------------
const day = atom({ plugin: "dl", key: "day" } as const, null);
const status = atom({ plugin: "dl", key: "status" } as const, null);
const tab = atom({ plugin: "dl", key: "tab" } as const, "chumash");
const pageAtom = atom({ plugin: "dl", key: "page" } as const, "read");
const perek = atom({ plugin: "dl", key: "perek" } as const, null);

// ---- band state ---------------------------------------------------------
let state: { key: string | null; data: Brief | null; error: string | null; loading: boolean } =
  { key: null, data: null, error: null, loading: false };
// The day the band was dismissed for (YYYY-MM-DD), kept in the store so new
// sessions that day stay quiet; a new day brings the band back.
let hiddenFor: string | null = null;

async function setHidden($: Host, key: string | null) {
  hiddenFor = key;
  if (key) await $.store.set("hidden", key);
  else await $.store.delete("hidden");
  $.ui.invalidate("ui.render");
}

async function getJSON($: Host, url: string) {
  const res = await $.http.fetch(url, {
    headers: { "User-Agent": "daily-learning (+https://github.com/sharshi/daily-learning-plugin)", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return JSON.parse(res.text);
}

// Fetch what the band needs for Gregorian day `d` and shape it.
async function buildBrief($: Host, d: Date): Promise<Brief> {
  const [heb, cal] = await Promise.all([getJSON($, hebcalUrl(d)), getJSON($, calendarUrl(d))]);
  let monthHas30 = true;
  if (+heb.hd === 29) {
    const next = new Date(d); next.setDate(d.getDate() + 1);
    try { monthHas30 = +(await getJSON($, hebcalUrl(next))).hd === 30; } catch {}
  }
  return briefFrom(d, hebrewDate(heb), cal, monthHas30);
}

// The band's brief for `key`: from memory, the store, or the network. The band
// redraws when it lands.
async function ensure($: Host, key: string) {
  if (state.key === key && (state.data || state.loading)) return;
  state = { key, data: null, error: null, loading: true };
  const storeKey = `brief-${key}`;
  try {
    const cached = (await $.store.get(storeKey)) as Brief | undefined;
    if (cached) {
      state.data = cached;
      return;
    }
    const data = await buildBrief($, new Date(`${key}T12:00:00`));
    if (state.key !== key) return; // day rolled over mid-fetch
    state.data = data;
    // Keep only today's brief in the store.
    for (const k of await $.store.keys()) if (k.startsWith("brief-") && k !== storeKey) await $.store.delete(k);
    await $.store.set(storeKey, data);
  } catch (e: any) {
    if (state.key === key) state.error = e?.message || String(e);
  } finally {
    if (state.key === key) state.loading = false;
    $.ui.invalidate("ui.render");
  }
}

// The fetch in flight, by day. A module variable, not $.state: a reload drops
// it with the fetch it tracked, so a "loading" left by an old module never
// blocks the next load.
let dayFetch: { key: string; done: Promise<void> } | null = null;

function ensureDay($: Host) {
  const key = todayKey();
  if (dayFetch?.key !== key) dayFetch = { key, done: loadDay($, key) };
  return dayFetch.done;
}

async function loadDay($: Host, key: string) {
  const d0 = await read($, day);
  if (d0?.key === key && d0.v === DAY_V) {
    await update($, status, () => ({ key, phase: "ready" }) as Status);
    return;
  }
  await update($, status, () => ({ key, phase: "loading" }) as Status);
  const storeKey = `day-v${DAY_V}-${key}`;
  try {
    let d = (await $.store.get(storeKey)) as Day | undefined;
    // Older builds kept a Day under day-<date>; the prune below removes it.
    if (!d) {
      const script = `${$.plugin.root}/scripts/dl.py`;
      const r = await $.process.run(["python3", script, "--json", "--full"], { timeoutMs: 300_000 });
      if (r.exitCode !== 0) throw new Error(r.stderr.trim().split("\n").pop() || `exit ${r.exitCode}`);
      d = toDay(key, JSON.parse(r.stdout));
      for (const k of await $.store.keys()) if (k.startsWith("day-") && k !== storeKey) await $.store.delete(k);
      await $.store.set(storeKey, d);
    }
    await update($, day, () => d!);
    await update($, status, () => ({ key, phase: "ready" }) as Status);
  } catch (e: any) {
    if (dayFetch?.key === key) dayFetch = null; // let the next open retry
    await update($, status, () => ({ key, phase: "error", error: e?.message || String(e) }) as Status);
  }
}

// A section Sefaria had no text for (Hayom Yom today, often) is left out of
// the sidebar and the band instead of pointing at a page that does not load.
const hasText = (d: Day, id: TabId) => (d.parts[id] ?? []).some((p) => p.he.length || p.en.length);
const shownTabs = (d: Day | null) => TABS.filter(([id]) => !d || hasText(d, id));

// Band rows → the sidebar tab that holds their text.
const BAND_TAB: Record<string, TabId> = {
  Chumash: "chumash", Tehillim: "tehillim", Tanya: "tanya",
  "Rambam ×3": "rambam3", "Rambam ×1": "rambam1", "Hayom Yom": "hayom", "Daf Yomi": "daf",
};

async function openPane($: Host, t?: TabId) {
  if (t) await update($, tab, () => t);
  await update($, pageAtom, () => "read");
  void ensureDay($);
  await $.ui.open({ id: PANE, title: "Daily Learning", focus: true });
}

// Terminals with a bidi of their own, which get termVisual's order (see
// hebrew.ts); every other terminal gets visual's.
const RLM = "\u200F";
const BIDI_TERMINALS = new Set(["Apple_Terminal"]);

// The chosen font as WOFF, base64, for the Desktop app's SVG pages; null for
// "System", until read, or if it can't be (the Desktop app then gets text).
let embedded: EmbeddedFont | null = null;

async function loadFont($: Host, choice: unknown) {
  const f = FONTS[String(choice)];
  if (!f) return;
  try {
    const r = await $.fs.read(`${$.plugin.root}/fonts/${f.file}.woff`, { as: "bytes" });
    embedded = typeof r === "string" ? null : { key: f.key, base64: r.base64 };
    $.ui.invalidate("ui.render");
  } catch {}
}

// ---- settings -------------------------------------------------------------
// The sidebar's settings are the plugin's own (userConfig): they persist, show
// in /config, and the settings page changes them with $.config.set, which
// reloads the mod with the new values.
const ENGLISH: Record<string, English> = { "Off": "off", "Staggered": "staggered", "Side by side": "side" };
const SIZES: Record<string, number> = { "Small": 0.88, "Medium": 1, "Large": 1.18 };

type Prefs = { font: string; english: English; nikkud: boolean; rashi: boolean; size: string };
function prefsOf(o: Record<string, unknown>): Prefs {
  return {
    font: String(o.hebrew_font ?? "Frank Ruhl"),
    english: ENGLISH[String(o.english)] ?? "off",
    nikkud: o.nikkud !== false,
    rashi: o.rashi !== false,
    size: SIZES[String(o.text_size)] ? String(o.text_size) : "Medium",
  };
}

// Change one setting as if in /config; say why when it can't be changed.
async function setPref($: Host, field: string, value: string | boolean) {
  try {
    const r = await $.config.set({ key: `dl.${field}`, value });
    if ("deny" in r && r.deny) $.ui.toast(`Daily Learning: couldn't change that setting: ${r.deny}`);
  } catch (err: any) {
    $.ui.toast(`Daily Learning: couldn't change that setting: ${err?.message || err}`);
  }
}

// ---- ui -----------------------------------------------------------------
// The "Hebrew font" setting's choices: each font's key (for its letter widths),
// its file under fonts/, and the family name inside it (Shlomo's is inherited
// from SIL's Ezra).
const FONTS: Record<string, { key: FontKey; file: string; family: string }> = {
  "Shlomo": { key: "shlomo", file: "Shlomo", family: "Ezra SIL SR" },
  "Frank Ruhl": { key: "frank", file: "FrankRuhlLibre-Regular", family: "Frank Ruhl Libre" },
};

// Install the chosen font and map Ghostty's Hebrew to it, or take the mapping
// back out for "System". Says so only when something changed.
async function applyFont($: Host, choice: unknown) {
  const script = `${$.plugin.root}/scripts/install-font.sh`;
  const f = FONTS[String(choice)];
  const argv = f ? ["/bin/sh", script, f.file, f.family] : ["/bin/sh", script, "--remove"];
  try {
    const r = await $.process.run(argv, { timeoutMs: 30_000 });
    const changed = r.stdout.split("\n").filter((l) => l.startsWith("changed:"));
    if (r.exitCode !== 0)
      $.ui.toast(`Daily Learning: Hebrew font setting failed: ${r.stderr.trim().split("\n").pop() || `install-font.sh exited ${r.exitCode}`}`);
    else if (changed.length)
      $.ui.toast(`Daily Learning: ${changed.map((l) => l.slice(9)).join("; ")}. Reload Ghostty's config (cmd+shift+,) to see it.`);
  } catch (err: any) {
    $.ui.toast(`Daily Learning: Hebrew font setting failed: ${err?.message || err}`);
  }
}

export const register: Register = (on, options) => {
  const prefs = prefsOf(options as Record<string, unknown>);
  on("session.start", async ($, e, next) => {
    void applyFont($, options.hebrew_font);
    void loadFont($, options.hebrew_font);
    hiddenFor = ((await $.store.get("hidden")) as string | undefined) ?? null;
    await $.command.register({ name: "dl-toggle", description: "Show or hide the daily learning line above the prompt" });
    await $.command.register({ name: "dl", description: "Open today's learning in a sidebar" });
    void ensure($, todayKey());
    void ensureDay($); // warm the sidebar text: from the store when cached
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const key = todayKey();
    if (hiddenFor === key) return next(e);
    const dd = await read($, day);
    const full = dd?.key === key && dd.v === DAY_V ? dd : null;
    void ensure($, key); // no-op unless the date rolled over

    if (state.loading && !state.data)
      return <Box paddingX={1}><Text dimColor>✡ dl · loading…</Text></Box>;
    if (state.error && !state.data)
      return <Box paddingX={1}><Text color="red">✡ dl · {state.error}</Text></Box>;
    if (!state.data) return next(e);

    // One line: the date opens the sidebar, each section opens its tab, Daf
    // Yomi (no tab) is text, and × hides the line for the rest of the day.
    const { heb, sections } = state.data;
    const date = `✡ ${heb.hd} ${heb.hm} ${heb.hy}` + (heb.events.length ? ` · ${heb.events.join(", ")}` : "");
    const shown = sections.filter(([l]) => !(full && BAND_TAB[l] && !hasText(full, BAND_TAB[l])));
    return (
      <Box paddingX={1} flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Button key="open" plain label={date} onPress={() => openPane($)} />
        {shown.map(([l, v]) => {
          const t = BAND_TAB[l];
          return t
            ? <Button key={`row-${l}`} plain label={l} onPress={() => openPane($, t)} />
            : <Text key={`row-${l}`} dimColor>{`${l} ${v}`}</Text>;
        })}
        <Button key="dismiss" plain role="dismiss" label="×" onPress={() => setHidden($, key)} />
      </Box>
    );
  });

  // /dl-toggle hides the line for today, or brings it back.
  on("command.run", { command: "dl-toggle" }, async ($) => {
    const key = todayKey();
    const hide = hiddenFor !== key;
    await setHidden($, hide ? key : null);
    return { text: hide ? "Hidden for today (/dl-toggle shows it again)." : "Shown." };
  });

  // /dl opens the sidebar and fetches the text in the background.
  on("command.run", { command: "dl" }, async ($) => {
    await openPane($);
    return { text: "Opened the sidebar. Keys: number keys for tabs · e English · n nikkud · s settings · j/k perek or amud · ↑↓ scroll · Esc back to prompt." };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const Svg = e.surface === "desktop" ? $.ui.resolve(e).Svg : null;
    const [d, st, t, pk, pg] = await Promise.all([
      read($, day), read($, status), read($, tab), read($, perek), read($, pageAtom),
    ]);
    const nk = prefs.nikkud;
    // Load on sight: a render never writes state, so start it on a timer.
    if ((d?.key !== todayKey() || d.v !== DAY_V) && st?.phase !== "error") $.clock.after(0, () => void ensureDay($));
    const width = Math.max(20, e.props.bodyColumns - 1);
    // Where the Hebrew is drawn decides its order: reversed here for a terminal
    // with no bidi, word order only for one that reverses each word, and reading
    // order for the Desktop app, which lays it out itself.
    const term = e.surface === "terminal" ? await $.env.get("TERM_PROGRAM") : undefined;
    const isBidiTerminal = e.surface === "terminal" && BIDI_TERMINALS.has(term ?? "");
    const isFlipped = e.surface === "terminal" && !isBidiTerminal;
    // How a line of Hebrew words is ordered for this surface. The Desktop app
    // lays Hebrew out itself but in a left-to-right line, so each line is
    // wrapped in right-to-left marks to keep edge punctuation on the Hebrew side.
    const order = isFlipped ? visual : isBidiTerminal ? termVisual : (ws: string[]) => RLM + ws.join(" ") + RLM;

    // A Hebrew paragraph, wrapped here and right-aligned line by line, each line
    // ordered for the surface. `label` (a halacha's "א.") leads the paragraph
    // in bold, at the right end of its first line.
    const he = (s: string, k: string, color?: "magenta", label?: string, w = width) => {
      const txt = cleanHe(s, nk);
      if (!txt) return null;
      const lines = wrap(label ? `${label} ${txt}` : txt, w);
      return (
        <Box key={k} flexDirection="column" alignItems="flex-end">
          {lines.map((ws, li) =>
            label && li === 0
              ? <Box flexDirection="row">
                  <Text color={color}>{order(ws.slice(1))} </Text>
                  <Text bold color={color}>{order(ws.slice(0, 1))}</Text>
                </Box>
              : <Text wrap="truncate" color={color}>{order(ws)}</Text>)}
        </Box>
      );
    };
    const en = (s: string, k: string, color?: "magenta", label?: string) => {
      const txt = cleanText(s);
      if (!txt) return null;
      return (
        <Box key={k} flexDirection="row">
          {label ? <Text bold dimColor={!color} color={color}>{label} </Text> : null}
          <Text dimColor={!color} color={color}>{txt}</Text>
        </Box>
      );
    };
    // A bold chapter heading, right-aligned like the Hebrew under it.
    const heading = (s: string, k: string) => (
      <Box key={k} flexDirection="column" alignItems="flex-end">
        <Text bold color="cyan">{order(s.split(" "))}</Text>
      </Box>
    );

    // A line of the body drawn as terminal text; a pair puts the English in
    // the left half and the Hebrew in the right.
    const half = Math.max(10, Math.floor((width - 2) / 2));
    const draw = (l: Line, k: string) =>
      l.kind === "gap" ? <Text key={k}> </Text>
        : l.kind === "heading" ? heading(l.text, k)
        : l.kind === "he" ? he(l.text, k, l.rashi ? "magenta" : undefined, l.label)
        : l.kind === "en" ? en(l.text, k, l.rashi ? "magenta" : undefined, l.label)
        : (
          <Box key={k} flexDirection="row" justifyContent="space-between">
            <Box width={half} flexDirection="column">{en(l.en, `${k}e`, l.rashi ? "magenta" : undefined, l.enLabel)}</Box>
            <Box width={half} flexDirection="column">{he(l.he, `${k}h`, l.rashi ? "magenta" : undefined, l.label, half)}</Box>
          </Box>
        );

    // The body's lines in the Desktop app: one SVG with the Hebrew font in it,
    // or text when the font isn't at hand or the page is too big for an SVG.
    const page = (lines: Line[], k: string) => {
      if (e.surface === "desktop" && embedded) {
        // About 7.8 CSS pixels a column, so the page draws near its real size
        // and its text sits with the app's own.
        const svgs = svgPages(lines.map((l) =>
          l.kind === "he" ? { ...l, text: cleanHe(l.text, nk) }
            : l.kind === "heading" ? { ...l, text: cleanHe(l.text, nk) }
            : l.kind === "en" ? { ...l, text: cleanText(l.text) }
            : l.kind === "pair" ? { ...l, he: cleanHe(l.he, nk), en: cleanText(l.en) } : l),
          embedded, { width: (width + 1) * 7.8, scale: SIZES[prefs.size]! });
        if (svgs && Svg) return svgs.map((src, i) => <Svg key={`${k}svg${i}`} source={src} alt="The day's text in Hebrew" />);
      }
      return lines.map((l, i) => draw(l, `${k}l${i}`));
    };

    // The settings page: each setting a row of choices; a press writes it.
    const settings = () => {
      const row = (field: string, title: string, choices: [string, string | boolean][], current: string | boolean, hint: string) => (
        <Box key={`set-${field}`} flexDirection="column" marginBottom={1}>
          <Text bold>{title}</Text>
          <Box flexDirection="row" flexWrap="wrap">
            {choices.map(([label, value]) => (
              <Button key={`set-${field}-${label.replace(/\W+/g, "-").toLowerCase()}`} label={label}
                variant={value === current ? "primary" : "secondary"} dimColor={value !== current}
                onPress={() => value === current ? undefined : setPref($, field, value)} />
            ))}
          </Box>
          <Text dimColor>{hint}</Text>
        </Box>
      );
      const onOff: [string, boolean][] = [["On", true], ["Off", false]];
      return [
        row("hebrew_font", "Hebrew font", [["Frank Ruhl", "Frank Ruhl"], ["Shlomo", "Shlomo"], ["System", "System"]], prefs.font,
          "Drawn in the Desktop app; installed and mapped in Ghostty. System leaves fonts alone."),
        row("english", "English", [["Off", "Off"], ["Staggered", "Staggered"], ["Side by side", "Side by side"]],
          Object.keys(ENGLISH).find((k) => ENGLISH[k] === prefs.english)!, "Staggered: under each paragraph. Side by side: English left, Hebrew right."),
        row("nikkud", "Nikkud", onOff, prefs.nikkud, "The Hebrew with or without vowels."),
        row("rashi", "Rashi", onOff, prefs.rashi, "Under each verse of Chumash and each passage of the Daf."),
        row("text_size", "Text size", [["Small", "Small"], ["Medium", "Medium"], ["Large", "Large"]], prefs.size,
          e.surface === "terminal" ? "For the Desktop app; a terminal uses its own size." : "The sidebar's text in the Desktop app."),
        <Button key="settings-done" label="‹ Back to the text" onPress={() => update($, pageAtom, () => "read")} />,
      ];
    };

    const body = () => {
      if (pg === "settings") return settings();
      if (!d || d.key !== todayKey()) {
        if (st?.phase === "error") return <Text color="red">Could not load: {st.error}</Text>;
        return <Text dimColor>Loading today's text… (the first fetch takes a little while)</Text>;
      }
      // A tab kept from an older build, or one hidden for lack of text, falls back to Chumash.
      const tabId: TabId = shownTabs(d).some(([id]) => id === t) ? t : "chumash";
      const parts = d.parts[tabId] ?? [];
      if (!parts.length) return <Text dimColor>Nothing listed for this today.</Text>;
      return parts.map((p, pi) => {
        const sections = p.sections ?? [];
        const n = sections.length;
        const at = Math.min(pk?.key === d.key ? pk.at[tabId] ?? 0 : 0, Math.max(n - 1, 0));
        const go = (i: number) => update($, perek, (v) =>
          ({ key: d.key, at: { ...(v?.key === d.key ? v.at : {}), [tabId]: i } }));
        // Previous and next section (perek, amud), above the text and below it.
        const nav = (where: "top" | "end") => n > 1 ? (
          <Box key={`${pi}nav-${where}`} flexDirection="row" justifyContent="space-between">
            {at > 0
              ? <Button key={`prev-${where}`} plain hotkey={where === "end" ? "k" : undefined}
                  label={`‹ ${p.unit} ${sections[at - 1]!.short}`} onPress={() => go(at - 1)} />
              : <Text> </Text>}
            <Text dimColor>{p.unit} {at + 1} of {n}</Text>
            {at < n - 1
              ? <Button key={`next-${where}`} plain hotkey={where === "end" ? "j" : undefined}
                  variant="primary" label={`next ${p.unit} ${sections[at + 1]!.short} ›`} onPress={() => go(at + 1)} />
              : <Text dimColor>done ✓</Text>}
          </Box>
        ) : null;
        const empty = !p.he.length && !p.en.length;
        return (
          <Box key={`p${pi}`} flexDirection="column" marginBottom={1}>
            <Text color="yellow" bold>{p.title}</Text>
            {empty && <Text dimColor>No text from Sefaria for this one; read it on chabad.org:</Text>}
            {(empty ? p.chabad || p.link : p.link) && <Text dimColor>{empty ? p.chabad || p.link : p.link}</Text>}
            <Text> </Text>
            {nav("top")}
            {page(linesFor(p, at, { english: prefs.english, rashi: prefs.rashi }), `p${pi}`)}
            {nav("end")}
          </Box>
        );
      });
    };

    const hebDate = d?.hebrew ? cleanHe(d.hebrew, nk) : "";
    // Missing text hides its tab, so its "... text: 404" line says nothing useful.
    const issues = (d?.errors ?? []).filter((x) => !/ text: /.test(x));
    // The header: date, tabs, toggles. Rows are packed here (a Button draws as
    // "[ label ]", a plain one as "k: label") so the header's height is known.
    const pack = <T,>(items: T[], w: (x: T) => number) => {
      const rows: T[][] = [];
      let row: T[] = [], n = 0;
      for (const x of items) {
        if (row.length && n + w(x) > width + 1) { rows.push(row); row = []; n = 0; }
        row.push(x); n += w(x);
      }
      if (row.length) rows.push(row);
      return rows;
    };
    const tabRows = pack(shownTabs(d).map((x, i) => [...x, i] as const), ([, label]) => label.length + 4);
    // e steps English through off, staggered and side by side; n turns nikkud
    // on or off; s opens the settings page (or goes back to the text).
    const englishLabel = { off: "off", staggered: "staggered", side: "side by side" }[prefs.english];
    const nextEnglish = { off: "Staggered", staggered: "Side by side", side: "Off" }[prefs.english];
    const toggleItems: [string, () => unknown, string][] = [
      ["english", () => setPref($, "english", nextEnglish), `English: ${englishLabel}`],
      ["nikkud", () => setPref($, "nikkud", !nk), `nikkud: ${nk ? "on" : "off"}`],
      ["settings", () => update($, pageAtom, (v) => v === "settings" ? "read" : "settings"), pg === "settings" ? "‹ text" : "⚙ settings"],
    ];
    const hotkeys: Record<string, string> = { english: "e", nikkud: "n", settings: "s" };
    const toggles = toggleItems.map(([key, press, label]) => [
      <Button key={key} plain hotkey={hotkeys[key]} label={label} onPress={press} />, label.length + 5,
    ] as const);
    const toggleRows = pack(toggles, ([, w]) => w);
    const header = [
      <Box key="date" flexDirection="row" justifyContent="space-between">
        <Text color="cyan" bold wrap="truncate">✡ {d?.title ?? "Daily Learning"}</Text>
        {hebDate ? <Text color="cyan" wrap="truncate">{order(hebDate.split(" "))}</Text> : null}
      </Box>,
      ...tabRows.map((row, r) => (
        <Box key={`tabs${r}`} flexDirection="row">
          {row.map(([id, label, i]) => (
            <Button key={`tab-${id}`} label={label} hotkey={String(i + 1)}
              variant={id === t ? "primary" : "secondary"} dimColor={id !== t}
              onPress={async () => { await update($, tab, () => id); await update($, pageAtom, () => "read"); }} />
          ))}
        </Box>
      )),
      ...toggleRows.map((row, r) => (
        <Box key={`toggles${r}`} flexDirection="row" gap={2}>{row.map(([b]) => b)}</Box>
      )),
      e.surface === "terminal" ? <Text key="rule" dimColor>{"─".repeat(width)}</Text> : <Text key="rule"> </Text>,
    ];

    // In the terminal the header stays put: it is drawn over the body at the
    // window's current top (the pane redraws as it scrolls), on a layer of
    // spaces that blanks the text scrolling beneath it, and a spacer of the
    // same height keeps the body's first rows clear of it.
    if (e.surface === "terminal") {
      const top = e.props.scroll?.offset ?? 0;
      const tall = header.length; // not `h`: that name is JSX's element factory
      return (
        <Box flexDirection="column">
          {Array.from({ length: tall }, (_, i) => <Text key={`gap${i}`}> </Text>)}
          {body()}
          {issues.length ? <Text dimColor>Issues: {issues.join("; ")}</Text> : null}
          <Box key="blank" position="absolute" top={top} left={0} flexDirection="column">
            {Array.from({ length: tall }, (_, i) => <Text key={`blank${i}`}>{" ".repeat(width + 1)}</Text>)}
          </Box>
          <Box key="header" position="absolute" top={top} left={0} flexDirection="column" width={width + 1}>
            {header}
          </Box>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        {header}
        {body()}
        {issues.length ? <Text dimColor>Issues: {issues.join("; ")}</Text> : null}
      </Box>
    );
  });
};
