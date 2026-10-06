// chitas: today's learning in a band above the prompt, and the full text in a
// sidebar (/chitas-pane). Both are cached per Gregorian day, in memory and in
// the mod's $.store. Data: ./data.ts; Hebrew layout: ./hebrew.ts.

import { atom, read, update } from "claude-code";
import type { EngineInterface as Host, Register, RenderChildren } from "claude-code";

import type { Day, Status, TabId } from "../types";
import { briefFrom, calendarUrl, DAY_V, hebcalUrl, hebrewDate, todayKey, toDay } from "./data";
import type { Brief } from "./data";
import { cleanHe, cleanText, gematria, termVisual, visual, wrap } from "./hebrew";

const PANE = "chitas";
const TABS: [TabId, string][] = [
  ["chumash", "Chumash + Rashi"], ["tehillim", "Tehillim"],
  ["tanya", "Tanya"], ["rambam1", "Rambam ×1"], ["rambam3", "Rambam ×3"], ["hayom", "Hayom Yom"],
];


// ---- pane state ---------------------------------------------------------
const day = atom({ plugin: "chitas", key: "day" } as const, null);
const status = atom({ plugin: "chitas", key: "status" } as const, null);
const tab = atom({ plugin: "chitas", key: "tab" } as const, "chumash");
const english = atom({ plugin: "chitas", key: "english" } as const, false);
const nikkud = atom({ plugin: "chitas", key: "nikkud" } as const, true);
const perek = atom({ plugin: "chitas", key: "perek" } as const, null);

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
    headers: { "User-Agent": "chitas-cc-mod (+https://github.com/sharshi/chitas-cc-mod)", Accept: "application/json" },
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
      const script = `${$.plugin.root}/scripts/chitas.py`;
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
  "Rambam ×3": "rambam3", "Rambam ×1": "rambam1", "Hayom Yom": "hayom",
};

async function openPane($: Host, t?: TabId) {
  if (t) await update($, tab, () => t);
  void ensureDay($);
  await $.ui.open({ id: PANE, title: "Chitas", focus: true });
}

// Terminals with a bidi of their own, which get termVisual's order (see
// hebrew.ts); every other terminal gets visual's.
const RLM = "\u200F";
const BIDI_TERMINALS = new Set(["Apple_Terminal"]);

// ---- ui -----------------------------------------------------------------
// The "Hebrew font" setting: install the bundled font and map Ghostty's Hebrew
// to it, or take that mapping back out. Terminal only: the Desktop app draws
// Hebrew with its own fonts. Says so only when something changed.
async function applyFont($: Host, choice: unknown) {
  const script = `${$.plugin.root}/scripts/install-font.sh`;
  const argv = choice === "Shlomo SemiStam" ? ["/bin/sh", script] : ["/bin/sh", script, "--remove"];
  try {
    const r = await $.process.run(argv, { timeoutMs: 30_000 });
    const changed = r.stdout.split("\n").filter((l) => l.startsWith("changed:"));
    if (r.exitCode !== 0) $.ui.toast(`chitas: Hebrew font setting failed: ${r.stderr.trim().split("\n").pop()}`);
    else if (changed.length)
      $.ui.toast(`chitas: ${changed.map((l) => l.slice(9)).join("; ")}. Reload Ghostty's config (cmd+shift+,) to see it.`);
  } catch (err: any) {
    $.ui.toast(`chitas: Hebrew font setting failed: ${err?.message || err}`);
  }
}

export const register: Register = (on, options) => {
  on("session.start", async ($, e, next) => {
    void applyFont($, options.hebrew_font);
    hiddenFor = ((await $.store.get("hidden")) as string | undefined) ?? null;
    await $.command.register({ name: "chitas-toggle", description: "Show or hide the chitas line above the prompt" });
    await $.command.register({ name: "chitas-pane", description: "Open today's Chitas text in a sidebar" });
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
      return <Box paddingX={1}><Text dimColor>✡ chitas · loading…</Text></Box>;
    if (state.error && !state.data)
      return <Box paddingX={1}><Text color="red">✡ chitas · {state.error}</Text></Box>;
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

  // /chitas-toggle hides the line for today, or brings it back.
  on("command.run", { command: "chitas-toggle" }, async ($) => {
    const key = todayKey();
    const hide = hiddenFor !== key;
    await setHidden($, hide ? key : null);
    return { text: hide ? "chitas: hidden for today (/chitas-toggle to show it)" : "chitas: shown" };
  });

  // /chitas-pane opens the sidebar and fetches the text in the background.
  on("command.run", { command: "chitas-pane" }, async ($) => {
    await openPane($);
    return { text: "Chitas opened in the sidebar. Keys: number keys for tabs · e English · n nikkud · j/k perek · ↑↓ scroll · Esc back to prompt." };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const [d, st, t, showEn, nk, pk] = await Promise.all([
      read($, day), read($, status), read($, tab), read($, english), read($, nikkud), read($, perek),
    ]);
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
    const he = (s: string, k: string, color?: "magenta", label?: string) => {
      const txt = cleanHe(s, nk);
      if (!txt) return null;
      const lines = wrap(label ? `${label} ${txt}` : txt, width);
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

    const body = () => {
      if (!d || d.key !== todayKey()) {
        if (st?.phase === "error") return <Text color="red">Could not load: {st.error}</Text>;
        return <Text dimColor>Loading today's text… (the first fetch takes a little while)</Text>;
      }
      // A tab kept from an older build, or one hidden for lack of text, falls back to Chumash.
      const parts = shownTabs(d).some(([id]) => id === t) ? d.parts[t] : d.parts.chumash;
      if (!parts.length) return <Text dimColor>Nothing listed for this today.</Text>;
      return parts.map((p, pi) => {
        // Verse by verse: the Hebrew, the English when on, then that verse's Rashi.
        const paired = p.he.length === p.en.length;
        const rashi = p.rashi && p.rashi.he.length === p.he.length ? p.rashi : null;
        const rows: RenderChildren[] = [];
        const chapters = p.chapters;
        if (chapters) {
          // Rambam: one perek at a time under its heading, each halacha led by
          // its number, with buttons to the previous and next perek.
          const n = chapters.length;
          const at = Math.min(pk?.key === d.key ? pk.i : 0, n - 1);
          const go = (i: number) => update($, perek, () => ({ key: d.key, i }));
          const nav = (where: "top" | "end") => n > 1 ? (
            <Box key={`${pi}nav-${where}`} flexDirection="row" justifyContent="space-between">
              {at > 0
                ? <Button key={`perek-prev-${where}`} plain hotkey={where === "end" ? "k" : undefined}
                    label={`‹ perek ${gematria(chapters[at - 1]!.n)}`} onPress={() => go(at - 1)} />
                : <Text> </Text>}
              <Text dimColor>perek {at + 1} of {n}</Text>
              {at < n - 1
                ? <Button key={`perek-next-${where}`} plain hotkey={where === "end" ? "j" : undefined}
                    variant="primary" label={`next perek ${gematria(chapters[at + 1]!.n)} ›`} onPress={() => go(at + 1)} />
                : <Text dimColor>done ✓</Text>}
            </Box>
          ) : null;
          const c = chapters[at]!;
          rows.push(nav("top"));
          rows.push(heading(`פרק ${gematria(c.n)}`, `${pi}c${at}`));
          const aligned = c.he.length === c.en.length;
          c.he.forEach((hv, i) => {
            rows.push(he(hv, `${pi}c${at}h${i}`, undefined, `${gematria(i + 1)}.`));
            if (showEn && aligned) rows.push(en(c.en[i]!, `${pi}c${at}e${i}`, undefined, `${i + 1}.`));
            rows.push(<Text key={`${pi}c${at}s${i}`}> </Text>);
          });
          rows.push(nav("end"));
        } else p.he.forEach((hv, i) => {
          rows.push(he(hv, `${pi}h${i}`));
          if (showEn && paired) rows.push(en(p.en[i]!, `${pi}e${i}`));
          rashi?.he[i]?.forEach((c, j) => rows.push(he(c, `${pi}r${i}.${j}`, "magenta")));
          if (showEn) rashi?.en[i]?.forEach((c, j) => rows.push(en(c, `${pi}re${i}.${j}`, "magenta")));
          rows.push(<Text key={`${pi}s${i}`}> </Text>);
        });
        if (showEn && !paired && !chapters) p.en.forEach((x, i) => { rows.push(en(x, `${pi}e${i}`)); rows.push(<Text key={`${pi}es${i}`}> </Text>); });
        // Rashi that did not line up with the verses still shows, after them.
        if (p.rashi && !rashi) p.rashi.he.flat().forEach((c, j) => rows.push(he(c, `${pi}rx${j}`, "magenta")));
        const empty = !p.he.length && !p.en.length;
        return (
          <Box key={`p${pi}`} flexDirection="column" marginBottom={1}>
            <Text color="yellow" bold>{p.title}</Text>
            {empty && <Text dimColor>No text from Sefaria for this one; read it on chabad.org:</Text>}
            {(empty ? p.chabad || p.link : p.link) && <Text dimColor>{empty ? p.chabad || p.link : p.link}</Text>}
            <Text> </Text>
            {rows.filter(Boolean)}
          </Box>
        );
      });
    };

    const hebDate = d?.hebrew ? cleanHe(d.hebrew, nk) : "";
    // Missing text hides its tab, so its "... text: 404" line says nothing useful.
    const issues = (d?.errors ?? []).filter((x) => !/ text: /.test(x));
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="cyan" bold>✡ {d?.title ?? "Chitas"}</Text>
          {hebDate ? <Text color="cyan">{order(hebDate.split(" "))}</Text> : null}
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          {shownTabs(d).map(([id, label], i) => (
            <Button key={`tab-${id}`} label={label} hotkey={String(i + 1)}
              variant={id === t ? "primary" : "secondary"} dimColor={id !== t}
              onPress={() => update($, tab, () => id)} />
          ))}
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          <Button key="english" plain hotkey="e" label={`English: ${showEn ? "on" : "off"}`}
            onPress={() => update($, english, (v) => !v)} />
          <Text> </Text>
          <Button key="nikkud" plain hotkey="n" label={`nikkud: ${nk ? "on" : "off"}`}
            onPress={() => update($, nikkud, (v) => !v)} />
        </Box>
        {e.surface === "terminal" ? <Text dimColor>{"─".repeat(width)}</Text> : <Text> </Text>}
        {body()}
        {issues.length ? <Text dimColor>Issues: {issues.join("; ")}</Text> : null}
      </Box>
    );
  });
};
