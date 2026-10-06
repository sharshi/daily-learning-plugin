// chitas mod — today's learning above the prompt, and the full text in a sidebar.
// Band data: hebcal.com (Hebrew date) + sefaria.org (calendar refs), cached per
// Gregorian day in memory and in the mod's $.store. The sidebar (/chitas-pane)
// runs scripts/chitas.py --json --full for the text and caches that the same way.

import { atom, read, update } from "claude-code";
import type { EngineInterface as Host, Register, RenderChildren } from "claude-code";

import type { Day, Lang, Part, Status, TabId } from "../types";

const PANE = "chitas";
const ALIYOT = ["Rishon", "Sheini", "Shlishi", "Revi'i", "Chamishi", "Shishi", "Shvi'i"];
const TEHILLIM: Record<number, string> = {
  1: "1-9", 2: "10-17", 3: "18-22", 4: "23-28", 5: "29-34", 6: "35-38", 7: "39-43",
  8: "44-48", 9: "49-54", 10: "55-59", 11: "60-65", 12: "66-68", 13: "69-71",
  14: "72-76", 15: "77-78", 16: "79-82", 17: "83-87", 18: "88-89", 19: "90-96",
  20: "97-103", 21: "104-105", 22: "106-107", 23: "108-112", 24: "113-118",
  25: "119:1-96", 26: "119:97-176", 27: "120-134", 28: "135-139", 29: "140-144",
  30: "145-150",
};
const HEB_MONTH: Record<string, string> = { "Sh'vat": "Shevat", Iyyar: "Iyar", Tamuz: "Tammuz" };
const TABS: [TabId, string][] = [
  ["chumash", "Chumash"], ["rashi", "Rashi"], ["tehillim", "Tehillim"],
  ["tanya", "Tanya"], ["rambam", "Rambam"], ["hayom", "Hayom Yom"],
];
const LANGS: Lang[] = ["both", "he", "en"];

// ---- pane state ---------------------------------------------------------
const day = atom({ plugin: "chitas", key: "day" } as const, null);
const status = atom({ plugin: "chitas", key: "status" } as const, null);
const tab = atom({ plugin: "chitas", key: "tab" } as const, "chumash");
const lang = atom({ plugin: "chitas", key: "lang" } as const, "both");
const nikkud = atom({ plugin: "chitas", key: "nikkud" } as const, true);
const flip = atom({ plugin: "chitas", key: "flip" } as const, null);

// ---- band state ---------------------------------------------------------
type Brief = { heb: { hd: number; hm: string; hy: number; hebrew: string; events: string[] }; sections: [string, string][] };
let state: { key: string | null; data: Brief | null; error: string | null; loading: boolean } =
  { key: null, data: null, error: null, loading: false };
let collapsed = false;

function todayKey(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- fetch (band) -------------------------------------------------------
async function getJSON($: Host, url: string) {
  const res = await $.http.fetch(url, { headers: { "User-Agent": "chitas-mod/0.1", Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return JSON.parse(res.text);
}

async function hebrewDate($: Host, d: Date) {
  const j = await getJSON($,
    `https://www.hebcal.com/converter?cfg=json&g2h=1&gy=${d.getFullYear()}&gm=${d.getMonth() + 1}&gd=${d.getDate()}`,
  );
  return { hd: +j.hd, hm: j.hm, hy: +j.hy, hebrew: j.hebrew || "", events: j.events || [] };
}

async function build($: Host, d: Date): Promise<Brief> {
  const [heb, cal] = await Promise.all([
    hebrewDate($, d),
    getJSON($, `https://www.sefaria.org/api/calendars?year=${d.getFullYear()}&month=${d.getMonth() + 1}&day=${d.getDate()}&diaspora=1`),
  ]);
  const items = Object.fromEntries((cal.calendar_items || []).map((i: any) => [i.title.en, i]));
  const out: Brief = { heb, sections: [] };

  const par = items["Parashat Hashavua"];
  if (par) {
    const wd = d.getDay(); // Sun=0 … Sat=6
    const aliyot = par.extraDetails?.aliyot || [];
    const ref = aliyot[wd] || par.ref;
    out.sections.push(["Chumash", `${par.displayValue.en} · ${ALIYOT[wd]} (${ref})`]);
  }

  let teh = TEHILLIM[heb.hd];
  if (heb.hd === 29) {
    const next = new Date(d); next.setDate(d.getDate() + 1);
    try { if ((await hebrewDate($, next)).hd !== 30) teh = "140-150"; } catch {}
  }
  out.sections.push(["Tehillim", `${teh}  (day ${heb.hd})`]);

  const tanya = items["Tanya Yomi"];
  if (tanya) out.sections.push(["Tanya", tanya.displayValue.en]);

  const r3 = items["Daily Rambam (3 Chapters)"], r1 = items["Daily Rambam"];
  if (r3) out.sections.push(["Rambam ×3", r3.displayValue.en]);
  if (r1) out.sections.push(["Rambam ×1", r1.displayValue.en]);

  out.sections.push(["Hayom Yom", `${HEB_MONTH[heb.hm] || heb.hm} ${heb.hd}`]);

  const daf = items["Daf Yomi"];
  if (daf) out.sections.push(["Daf Yomi", daf.displayValue.en]);
  return out;
}

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
    const data = await build($, new Date(`${key}T12:00:00`));
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

// ---- fetch (pane) -------------------------------------------------------
// Sefaria nests chapters as arrays of arrays; flatten to paragraphs.
function flat(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(flat);
  return [String(v)];
}

function part(title: string, s: any, text: any): Part {
  return { title, link: s?.link, chabad: s?.chabad, he: flat(text?.he), en: flat(text?.en) };
}

function toDay(key: string, j: any): Day {
  const s = j.sections || {};
  const ch = s.chumash, rb = s.rambam || {};
  const parts: Record<TabId, Part[]> = {
    chumash: ch ? [part(`${ch.parsha} · ${ch.aliyah} (${ch.ref})`, ch, ch.text)] : [],
    rashi: ch?.rashi ? [part(ch.rashi.ref, { link: ch.link, chabad: ch.chabad }, ch.rashi)] : [],
    tehillim: s.tehillim ? [part(`Tehillim ${s.tehillim.ref} (day ${s.tehillim.day_of_month})`, s.tehillim, s.tehillim.text)] : [],
    tanya: s.tanya ? [part(`Tanya · ${s.tanya.display || s.tanya.ref}`, s.tanya, s.tanya.text)] : [],
    rambam: [
      ...(rb.three_perakim ? [part(`Rambam ×3 · ${rb.three_perakim.display}`, { ...rb.three_perakim, chabad: rb.chabad }, rb.three_perakim.text)] : []),
      ...(rb.one_perek ? [part(`Rambam ×1 · ${rb.one_perek.display}`, { ...rb.one_perek, chabad: rb.chabad }, rb.one_perek.text)] : []),
    ],
    hayom: s.hayom_yom ? [part(s.hayom_yom.ref, s.hayom_yom, s.hayom_yom.text)] : [],
  };
  const hd = j.hebrew || {};
  return {
    key,
    title: `${j.weekday} ${j.gregorian} · ${hd.hd} ${hd.hm} ${hd.hy}`,
    hebrew: hd.hebrew || "",
    parts,
    errors: j.errors || [],
  };
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
  if (d0?.key === key) {
    await update($, status, () => ({ key, phase: "ready" }) as Status);
    return;
  }
  await update($, status, () => ({ key, phase: "loading" }) as Status);
  const storeKey = `day-${key}`;
  try {
    let d = (await $.store.get(storeKey)) as Day | undefined;
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

// Band rows → the sidebar tab that holds their text.
const BAND_TAB: Record<string, TabId> = {
  Chumash: "chumash", Tehillim: "tehillim", Tanya: "tanya",
  "Rambam ×3": "rambam", "Rambam ×1": "rambam", "Hayom Yom": "hayom",
};

async function openPane($: Host, t?: TabId) {
  if (t) await update($, tab, () => t);
  void ensureDay($);
  await $.ui.open({ id: PANE, title: "Chitas", focus: true });
}

// ---- Hebrew -------------------------------------------------------------
// Combining marks: te'amim (cantillation) and nikkud (vowels, dagesh, shin dots).
const MARK = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/;
const TEAMIM = /[\u0591-\u05AF\u05BD]/g;
const NIKKUD = /[\u05B0-\u05BC\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
const HEB = /[\u05D0-\u05EA]/;
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<" };

function cleanText(s: string) {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&thinsp;|&ensp;|&emsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&[a-z]+;/g, "")
    .replace(/\{[\u05E1\u05E4]\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHe(s: string, withNikkud: boolean) {
  let t = cleanText(s).replace(TEAMIM, "").replace(/\s*\u05C0\s*/g, " "); // drop te'amim and paseq
  if (!withNikkud) t = t.replace(NIKKUD, "");
  return t;
}

// Base letters with their marks, so reversing keeps each vowel on its letter.
function clusters(w: string) {
  const out: string[] = [];
  for (const ch of w) {
    if (MARK.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

const cells = (w: string) => clusters(w).length;

function wrap(s: string, width: number) {
  const lines: string[][] = [];
  let line: string[] = [], n = 0;
  for (const w of s.split(" ").filter(Boolean)) {
    const c = cells(w);
    if (line.length && n + 1 + c > width) { lines.push(line); line = []; n = 0; }
    n += (line.length ? 1 : 0) + c;
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}

// Visual order for a terminal that draws everything left to right: words right
// to left, letters inside a Hebrew word reversed, numbers and Latin kept as is.
function visual(words: string[]) {
  return words
    .slice()
    .reverse()
    .map((w) => (HEB.test(w) ? clusters(w).reverse().map((c) => MIRROR[c] ?? c).join("") : w))
    .join(" ");
}

// ---- ui -----------------------------------------------------------------
export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "chitas-toggle", description: "Collapse or expand the chitas band above the prompt" });
    await $.command.register({ name: "chitas-pane", description: "Open today's Chitas text in a sidebar" });
    void ensure($, todayKey());
    void ensureDay($); // warm the sidebar text: from the store when cached
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const key = todayKey();
    void ensure($, key); // no-op unless the date rolled over

    if (state.loading && !state.data)
      return <Box paddingX={1}><Text dimColor>✡ chitas · loading…</Text></Box>;
    if (state.error && !state.data)
      return <Box paddingX={1}><Text color="red">✡ chitas · {state.error}</Text></Box>;
    if (!state.data) return next(e);

    const { heb, sections } = state.data;
    const header = `✡ ${heb.hd} ${heb.hm} ${heb.hy}` +
      (heb.events.length ? ` · ${heb.events.join(", ")}` : "") +
      "   /chitas-pane for text";

    if (collapsed)
      return <Box paddingX={1}><Text dimColor>{header}</Text></Box>;

    // Each row opens the sidebar on its section; Daf Yomi has no tab, so it stays text.
    return (
      <Box paddingX={1} flexDirection="column">
        <Button key="open" plain label={header} onPress={() => openPane($)} />
        {sections.map(([l, v]) => {
          const t = BAND_TAB[l];
          const label = `${l.padEnd(10)} ${v}`;
          return t
            ? <Button key={`row-${l}`} plain label={label} onPress={() => openPane($, t)} />
            : <Text dimColor>{label}</Text>;
        })}
      </Box>
    );
  });

  // /chitas-toggle collapses the band to one line.
  on("command.run", { command: "chitas-toggle" }, async ($) => {
    collapsed = !collapsed;
    $.ui.invalidate("ui.render");
    return { text: collapsed ? "chitas: collapsed" : "chitas: expanded" };
  });

  // /chitas-pane opens the sidebar and fetches the text in the background.
  on("command.run", { command: "chitas-pane" }, async ($) => {
    await openPane($);
    return { text: "Chitas opened in the sidebar. Keys: 1-6 tabs · l language · n nikkud · r flip Hebrew · ↑↓ scroll · Esc back to prompt." };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const [d, st, t, lg, nk, fl] = await Promise.all([
      read($, day), read($, status), read($, tab), read($, lang), read($, nikkud), read($, flip),
    ]);
    // Load on sight: a render never writes state, so start it on a timer.
    if (d?.key !== todayKey() && st?.phase !== "error") $.clock.after(0, () => void ensureDay($));
    const width = Math.max(20, e.props.bodyColumns - 1);
    const isFlipped = fl ?? e.surface === "terminal";

    // A Hebrew paragraph: wrapped and reversed line by line where the surface
    // has no bidi, otherwise one right-aligned Text the surface lays out.
    const he = (s: string, k: string) => {
      const txt = cleanHe(s, nk);
      if (!txt) return null;
      if (!isFlipped)
        return <Box key={k} flexDirection="column" alignItems="flex-end"><Text>{txt}</Text></Box>;
      return (
        <Box key={k} flexDirection="column" alignItems="flex-end">
          {wrap(txt, width).map((ws) => <Text wrap="truncate">{visual(ws)}</Text>)}
        </Box>
      );
    };
    const en = (s: string, k: string) => {
      const txt = cleanText(s);
      return txt ? <Box key={k}><Text>{txt}</Text></Box> : null;
    };

    const body = () => {
      if (!d || d.key !== todayKey()) {
        if (st?.phase === "error") return <Text color="red">Could not load: {st.error}</Text>;
        return <Text dimColor>Loading today's text… (the first fetch takes a little while)</Text>;
      }
      const parts = d.parts[t];
      if (!parts.length) return <Text dimColor>Nothing listed for this today.</Text>;
      return parts.map((p, pi) => {
        const showHe = lg !== "en", showEn = lg !== "he";
        // Interleave verse by verse when the two languages line up.
        const paired = showHe && showEn && p.he.length === p.en.length;
        const rows: RenderChildren[] = [];
        if (paired) {
          p.he.forEach((hv, i) => {
            rows.push(he(hv, `${pi}h${i}`));
            rows.push(en(p.en[i]!, `${pi}e${i}`));
            rows.push(<Text key={`${pi}s${i}`}> </Text>);
          });
        } else {
          if (showHe) p.he.forEach((hv, i) => { rows.push(he(hv, `${pi}h${i}`)); rows.push(<Text key={`${pi}hs${i}`}> </Text>); });
          if (showEn) p.en.forEach((x, i) => { rows.push(en(x, `${pi}e${i}`)); rows.push(<Text key={`${pi}es${i}`}> </Text>); });
        }
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
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="cyan" bold>✡ {d?.title ?? "Chitas"}</Text>
          {hebDate ? <Text color="cyan">{isFlipped ? visual(hebDate.split(" ")) : hebDate}</Text> : null}
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          {TABS.map(([id, label], i) => (
            <Button key={`tab-${id}`} label={label} hotkey={String(i + 1)}
              variant={id === t ? "primary" : "secondary"} dimColor={id !== t}
              onPress={() => update($, tab, () => id)} />
          ))}
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          <Button key="lang" plain hotkey="l" label={`lang: ${lg}`}
            onPress={() => update($, lang, (v) => LANGS[(LANGS.indexOf(v) + 1) % LANGS.length]!)} />
          <Text> </Text>
          <Button key="nikkud" plain hotkey="n" label={`nikkud: ${nk ? "on" : "off"}`}
            onPress={() => update($, nikkud, (v) => !v)} />
          <Text> </Text>
          <Button key="flip" plain hotkey="r" label={`flip Hebrew: ${isFlipped ? "on" : "off"}`}
            onPress={() => update($, flip, () => !isFlipped)} />
        </Box>
        <Text dimColor>{"─".repeat(width)}</Text>
        {body()}
        {d?.errors.length ? <Text dimColor>Issues: {d.errors.join("; ")}</Text> : null}
      </Box>
    );
  });
};
