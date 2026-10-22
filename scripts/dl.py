#!/usr/bin/env python3
"""dl.py — today's daily learning (Chitas, Rambam, Hayom Yom, Daf Yomi), from the terminal.

Chumash (daily aliyah) with Rashi, Tehillim (monthly cycle), Tanya Yomi,
Rambam (1 or 3 perakim), Hayom Yom, Daf Yomi. Stdlib only. Sources:
shafeh.org (calendar, daily portions, and bundled texts).

Usage:
  dl.py                      # today, refs + Chumash/Rashi text
  dl.py --date 2026-10-05    # a specific Gregorian date
  dl.py --after-sunset       # roll to the next Hebrew day
  dl.py --refs               # refs + links only, no text
  dl.py --full               # pull text for every section, not just Chumash
  dl.py --no-rashi           # skip Rashi
  dl.py --lang he|en|both    # default: both
  dl.py --json               # machine-readable, for Claude to summarize
  dl.py --no-cache
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = "daily-learning/1.0 (+https://github.com/sharshi/daily-learning-plugin)"
CACHE_DIR = os.path.expanduser("~/.cache/daily-learning")
TIMEOUT = 20

BASE = "https://shafeh.org"
API = BASE + "/api/v1"


# ---------------------------------------------------------------- http ----
def get_json(url, use_cache=True):
    key = re.sub(r"[^A-Za-z0-9]+", "_", url)[-180:]
    path = os.path.join(CACHE_DIR, key + ".json")
    if use_cache and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = json.loads(r.read().decode("utf-8"))
    if use_cache:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
    return data


def safe(fn, *a, **kw):
    try:
        return fn(*a, **kw), None
    except Exception as e:  # network, parse, 404 — never kill the whole brief
        return None, f"{type(e).__name__}: {e}"


# --------------------------------------------------------------- Shafeh ----
def strip_html(s):
    import html
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s or ""))).strip()


def build(g, args):
    use_cache = not args.no_cache
    errors = []
    brief = {"gregorian": g.isoformat(), "weekday": g.strftime("%A"), "sections": {}}
    S = brief["sections"]

    def fetch(path):
        data, err = safe(get_json, API + path, use_cache)
        if err:
            errors.append(f"Shafeh {path}: {err}")
        return data or {}

    def text(he, en):
        return {"he": [strip_html(x) for x in he] if args.lang != "en" else [],
                "en": [strip_html(x) for x in en] if args.lang != "he" and any(en) else []}

    query = "?date=" + g.isoformat()
    today = fetch("/today" + query)
    hd = today.get("hebrew_date", {})
    brief["hebrew"] = {"hd": hd.get("day"), "hm": hd.get("month_name"),
                       "hy": hd.get("year"), "hebrew": hd.get("hebrew", ""),
                       "events": [today["holiday"]["english"]] if today.get("holiday") else []}
    rows = {r["key"]: r for r in today.get("limudim", [])}
    ch = fetch("/learning/chumash" + query + ("&refs=1" if args.refs else ""))
    if ch.get("available"):
        verses = ch.get("verses", [])
        coords = verses if args.refs else [[v["chapter"], v["verse"]] for v in verses]
        if coords:
            start, end = coords[0], coords[-1]
            ref = f"{ch['book']} {start[0]}:{start[1]}-{end[0]}:{end[1]}"
            sec = {"parsha": ch["parsha"], "aliyah": ch["aliyah"], "ref": ref,
                   "link": BASE + "/today/" + g.isoformat()}
            if not args.refs:
                t = text([v["text"] for v in verses], [v.get("english") or "" for v in verses])
                chapters = []
                for v in verses:
                    if not chapters or chapters[-1][0] != v["chapter"]:
                        chapters.append((v["chapter"], []))
                    chapters[-1][1].append(v["text"])
                t["he_chapters"] = [values for _, values in chapters]
                sec["text"] = t
                if not args.no_rashi:
                    sec["rashi"] = {"he_verses": [v.get("rashi", []) for v in verses], "en_verses": []}
            S["chumash"] = sec

    row = rows.get("tehillim")
    if row:
        first, last = row["range"]
        ref = f"Psalms {first}:{row['start_verse']}-{row['end_verse']}" if row.get("end_verse") else f"Psalms {first}-{last}"
        sec = {"ref": ref, "day_of_month": hd.get("day"), "link": BASE + f"/tehillim/range/{first}-{last}"}
        if args.full and not args.refs:
            verses = []
            for chapter in range(first, last + 1):
                data = fetch(f"/tehillim/{chapter}")
                verses.extend(v for v in data.get("verses", [])
                              if (chapter != first or v["number"] >= row.get("start_verse", 1))
                              and (chapter != last or not row.get("end_verse") or v["number"] <= row["end_verse"]))
            sec["text"] = text([v["text"] for v in verses], [v.get("english") or "" for v in verses])
        S["tehillim"] = sec

    row = rows.get("chitas_tanya")
    if row:
        sec = {"ref": row["value"], "display": row["value"], "link": BASE + "/tanya/today?date=" + g.isoformat()}
        if args.full and not args.refs:
            data = fetch("/learning/tanya" + query)
            segments = data.get("segments", [])
            sec["text"] = text([v["text"] for v in segments], [v.get("english") or "" for v in segments])
        S["tanya"] = sec

    S["rambam"] = {}
    for key, track, row_key in [("three_perakim", 3, "rambam"), ("one_perek", 1, "rambam_1")]:
        if row_key not in rows:
            continue
        data = fetch("/learning/rambam" + query + f"&track={track}" + ("" if args.full and not args.refs else "&refs=1"))
        chapters = data.get("chapters", [])
        if not chapters:
            continue
        sec = {"ref": f"{chapters[0]['name']} {chapters[0]['chapter']}", "display": rows[row_key]["value"],
               "link": BASE + f"/rambam/today?date={g.isoformat()}&track={track}"}
        if args.full and not args.refs:
            he = [[h["text"] for h in c["halachos"]] for c in chapters]
            en = [[h.get("english") or "" for h in c["halachos"]] for c in chapters]
            sec["text"] = text([h for c in he for h in c], [h for c in en for h in c])
            # Preserve chapter numbers when the three-perek reading crosses hilchos.
            sec["chapters"] = [{"name": c["hebrew_name"], "number": c["chapter"],
                                **text(h, e)} for c, h, e in zip(chapters, he, en)]
        S["rambam"][key] = sec

    row = rows.get("hayom_yom")
    if row:
        sec = {"ref": "Hayom Yom · " + row["value"], "link": BASE + "/hayom-yom/" + row["entry_key"]}
        if not args.refs:
            data = fetch("/learning/hayom-yom" + query)
            langs = data.get("languages", {})
            sec["text"] = text(langs.get("he", {}).get("text", []), langs.get("en", {}).get("text", []))
        S["hayom_yom"] = sec

    row = rows.get("daf_yomi")
    if row:
        sec = {"ref": row["value"], "display": row["value"], "amudim": [], "link": BASE + "/shas"}
        if row.get("amudim"):
            sec["link"] += f"/{row['masechet']}/{row['amudim'][0]}"
        if args.full and not args.refs:
            if not row.get("available"):
                errors.append(f"Shafeh has no bundled text for {row['value']}")
            for amud in row.get("amudim", []):
                data = fetch(f"/shas/{row['masechet']}/{amud}")
                # The corpus has amud-level Rashi, not passage alignment. Keep
                # it separate so a short list is never paired with wrong lines.
                sec["amudim"].append({"amud": amud, **text([v["he"] for v in data.get("lines", [])], []),
                                       "rashi_notes": [strip_html(v['d'] + " — " + v['c']) for v in data.get("rashi", [])] if not args.no_rashi else []})
        S["daf_yomi"] = sec

    brief["errors"] = errors
    return brief


# -------------------------------------------------------------- render ----
def render_text(block, lang, limit=None):
    """Interleave he/en lines. Returns a list of strings."""
    if not block:
        return ["  (text unavailable)"]
    he, en = block.get("he", []), block.get("en", [])
    n = max(len(he), len(en))
    out = []
    for i in range(n if limit is None else min(n, limit)):
        if lang in ("he", "both") and i < len(he):
            out.append("  " + he[i])
        if lang in ("en", "both") and i < len(en):
            out.append("  " + en[i])
        if lang == "both":
            out.append("")
    if limit is not None and n > limit:
        out.append(f"  … {n - limit} more")
    return out


def render(brief, args):
    L = []
    h = brief.get("hebrew") or {}
    head = f"{brief['weekday']} {brief['gregorian']}"
    if h:
        head += f"  ·  {h['hd']} {h['hm']} {h['hy']}  ·  {h['hebrew']}"
    L.append(head)
    if h.get("events"):
        L.append("  " + ", ".join(h["events"]))
    L.append("")
    S = brief["sections"]

    c = S.get("chumash")
    if c:
        L.append(f"- Chumash: {c['parsha']} — {c['aliyah']} ({c['ref']})")
        L.append(f"  {c['link']}")
        if "text" in c:
            L.append("")
            L.extend(render_text(c["text"], args.lang))
        if c.get("rashi") is not None:
            L.append("- Rashi on " + c["ref"])
            L.extend(render_text(c["rashi"], args.lang, limit=args.rashi_limit))
    if S.get("haftarah"):
        L.append(f"- Haftarah: {S['haftarah']['ref']}")

    t = S.get("tehillim")
    if t:
        L.append(f"- Tehillim (day {t['day_of_month']}): {t['ref']}")
        L.append(f"  {t['link']}")
        if t.get("text"):
            L.extend(render_text(t["text"], args.lang))

    ta = S.get("tanya", {})
    if ta.get("ref"):
        L.append(f"- Tanya: {ta['display']}")
        L.append(f"  {ta['link']}")
        if ta.get("text"):
            L.extend(render_text(ta["text"], args.lang))
    else:
        L.append(f"- Tanya: {ta.get('link', 'Text unavailable')}")

    r = S.get("rambam", {})
    if r.get("three_perakim"):
        L.append(f"- Rambam (3 perakim): {r['three_perakim']['display']}")
        L.append(f"  {r['three_perakim']['link']}")
        if r["three_perakim"].get("text"):
            L.extend(render_text(r["three_perakim"]["text"], args.lang))
    if r.get("one_perek"):
        L.append(f"- Rambam (1 perek): {r['one_perek']['display']}")
        L.append(f"  {r['one_perek']['link']}")
        if r["one_perek"].get("text"):
            L.extend(render_text(r["one_perek"]["text"], args.lang))

    hy = S.get("hayom_yom")
    if hy:
        L.append(f"- Hayom Yom: {hy['ref']}")
        if hy.get("text") and (hy["text"]["he"] or hy["text"]["en"]):
            L.extend(render_text(hy["text"], args.lang))
        else:
            L.append(f"  {hy['link']}")

    d = S.get("daf_yomi")
    if d:
        L.append(f"- Daf Yomi: {d['display']}")
        L.append(f"  {d['link']}")
        for a in d.get("amudim") or []:
            L.append(f"  [{a['amud']}]")
            L.extend(render_text(a, args.lang))
            if not args.no_rashi and a.get("rashi_notes"):
                L.append("  Rashi:")
                L.extend("  " + note for note in a["rashi_notes"])

    if brief["errors"]:
        L.append("")
        L.append("- Issues:")
        L.extend("  " + e for e in brief["errors"])
    return "\n".join(L)


# ---------------------------------------------------------------- main ----
def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--date", help="YYYY-MM-DD (default: today)")
    p.add_argument("--after-sunset", action="store_true", help="use the next Hebrew day")
    p.add_argument("--refs", action="store_true", help="refs and links only")
    p.add_argument("--full", action="store_true", help="fetch text for every section")
    p.add_argument("--no-rashi", action="store_true")
    p.add_argument("--rashi-limit", type=int, default=None, help="max Rashi comments to print")
    p.add_argument("--lang", choices=["he", "en", "both"], default="both")
    p.add_argument("--json", action="store_true")
    p.add_argument("--no-cache", action="store_true")
    args = p.parse_args()

    # Windows consoles and pipes default to a legacy code page (cp1252), which
    # can't encode Hebrew; always write UTF-8, which is what the pane expects.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    g = dt.date.fromisoformat(args.date) if args.date else dt.date.today()
    if args.after_sunset:
        g += dt.timedelta(days=1)

    brief = build(g, args)
    if args.json:
        json.dump(brief, sys.stdout, ensure_ascii=False, indent=2)
        print()
    else:
        print(render(brief, args))
    return 1 if (brief["errors"] and not brief["sections"]) else 0


if __name__ == "__main__":
    sys.exit(main())
