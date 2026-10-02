// chitas mod — today's learning above the prompt.
// Data: hebcal.com (Hebrew date) + sefaria.org (calendar refs). Cached per
// Gregorian day in memory and on disk (~/.cache/chitas/). Refs only here;
// /chitas (commands/chitas.md) prints full text via scripts/chitas.py.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_DIR = join(homedir(), ".cache", "chitas");
const ALIYOT = ["Rishon", "Sheini", "Shlishi", "Revi'i", "Chamishi", "Shishi", "Shvi'i"];
const TEHILLIM = {
  1: "1-9", 2: "10-17", 3: "18-22", 4: "23-28", 5: "29-34", 6: "35-38", 7: "39-43",
  8: "44-48", 9: "49-54", 10: "55-59", 11: "60-65", 12: "66-68", 13: "69-71",
  14: "72-76", 15: "77-78", 16: "79-82", 17: "83-87", 18: "88-89", 19: "90-96",
  20: "97-103", 21: "104-105", 22: "106-107", 23: "108-112", 24: "113-118",
  25: "119:1-96", 26: "119:97-176", 27: "120-134", 28: "135-139", 29: "140-144",
  30: "145-150",
};
const HEB_MONTH = { "Sh'vat": "Shevat", Iyyar: "Iyar", Tamuz: "Tammuz" };

// ---- state --------------------------------------------------------------
let state = { key: null, data: null, error: null, loading: false };
let collapsed = false;

function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- fetch --------------------------------------------------------------
async function getJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": "chitas-mod/0.1", Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function hebrewDate(d) {
  const j = await getJSON(
    `https://www.hebcal.com/converter?cfg=json&g2h=1&gy=${d.getFullYear()}&gm=${d.getMonth() + 1}&gd=${d.getDate()}`,
  );
  return { hd: +j.hd, hm: j.hm, hy: +j.hy, hebrew: j.hebrew || "", events: j.events || [] };
}

async function build(d) {
  const [heb, cal] = await Promise.all([
    hebrewDate(d),
    getJSON(`https://www.sefaria.org/api/calendars?year=${d.getFullYear()}&month=${d.getMonth() + 1}&day=${d.getDate()}&diaspora=1`),
  ]);
  const items = Object.fromEntries((cal.calendar_items || []).map((i) => [i.title.en, i]));
  const out = { heb, sections: [] };

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
    try { if ((await hebrewDate(next)).hd !== 30) teh = "140-150"; } catch {}
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

async function ensure(key) {
  if (state.key === key && (state.data || state.loading)) return;
  state = { key, data: null, error: null, loading: true };
  const file = join(CACHE_DIR, `brief-${key}.json`);
  try {
    state.data = JSON.parse(await readFile(file, "utf8"));
    state.loading = false;
    return;
  } catch {}
  try {
    const data = await build(new Date(`${key}T12:00:00`));
    if (state.key !== key) return; // day rolled over mid-fetch
    state.data = data;
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(data));
  } catch (e) {
    state.error = e.message || String(e);
  } finally {
    state.loading = false;
  }
}

// ---- ui -----------------------------------------------------------------
export function register(on) {
  // Kick off the fetch immediately so the first render is usually warm.
  ensure(todayKey());

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e);
    const key = todayKey();
    ensure(key); // no-op unless the date rolled over

    const line = (label, value, color) =>
      Box({ flexDirection: "row", children: [
        Text({ color: color || "yellow", bold: true, children: `${label.padEnd(10)} ` }),
        Text({ children: value }),
      ] });

    if (state.loading && !state.data)
      return Box({ paddingX: 1, children: [Text({ dimColor: true, children: "✡ chitas · loading…" })] });
    if (state.error && !state.data)
      return Box({ paddingX: 1, children: [Text({ color: "red", children: `✡ chitas · ${state.error}` })] });

    const { heb, sections } = state.data;
    const header = `✡ ${heb.hd} ${heb.hm} ${heb.hy}` +
      (heb.events.length ? ` · ${heb.events.join(", ")}` : "") +
      "   /chitas for text";

    if (collapsed)
      return Box({ paddingX: 1, children: [Text({ dimColor: true, children: header })] });

    return Box({
      paddingX: 1, flexDirection: "column",
      children: [
        Text({ color: "cyan", bold: true, children: header }),
        ...sections.map(([l, v]) => line(l, v)),
      ],
    });
  });

  // Optional: /chitas-toggle to collapse the panel to one line. The command
  // event name below follows the pattern in the mods docs; if your
  // /plugin-types output names it differently, adjust or delete this block.
  try {
    on("command", { name: "chitas-toggle" }, ($, e, next) => {
      collapsed = !collapsed;
      return { message: collapsed ? "chitas: collapsed" : "chitas: expanded" };
    });
  } catch {}
}
