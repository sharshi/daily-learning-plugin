#!/usr/bin/env python3
"""dl.py — today's daily learning (Chitas, Rambam, Hayom Yom, Daf Yomi), from the terminal.

Chumash (daily aliyah) with Rashi, Tehillim (monthly cycle), Tanya Yomi,
Rambam (1 or 3 perakim), Hayom Yom, Daf Yomi. Stdlib only. Sources:
hebcal.com (Hebrew date) and sefaria.org (calendars + texts).

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

# Chabad monthly Tehillim cycle, by Hebrew day of month.
TEHILLIM = {
    1: "1-9", 2: "10-17", 3: "18-22", 4: "23-28", 5: "29-34", 6: "35-38",
    7: "39-43", 8: "44-48", 9: "49-54", 10: "55-59", 11: "60-65", 12: "66-68",
    13: "69-71", 14: "72-76", 15: "77-78", 16: "79-82", 17: "83-87", 18: "88-89",
    19: "90-96", 20: "97-103", 21: "104-105", 22: "106-107", 23: "108-112",
    24: "113-118", 25: "119:1-96", 26: "119:97-176", 27: "120-134",
    28: "135-139", 29: "140-144", 30: "145-150",
}

# hebcal month name -> Sefaria's Hayom Yom section name
HEB_MONTH = {
    "Tishrei": "Tishrei", "Cheshvan": "Cheshvan", "Kislev": "Kislev",
    "Tevet": "Tevet", "Sh'vat": "Shevat", "Adar": "Adar", "Adar I": "Adar I",
    "Adar II": "Adar II", "Nisan": "Nisan", "Iyyar": "Iyar", "Sivan": "Sivan",
    "Tamuz": "Tammuz", "Av": "Av", "Elul": "Elul",
}

ALIYAH_NAMES = ["Rishon", "Sheini", "Shlishi", "Revi'i", "Chamishi", "Shishi", "Shvi'i"]


# ---------------------------------------------------------------- http ----
def get_json(url, use_cache=True):
    key = re.sub(r"[^A-Za-z0-9]+", "_", url)[-180:]
    path = os.path.join(CACHE_DIR, key + ".json")
    if use_cache and os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = json.loads(r.read().decode("utf-8"))
    if use_cache:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f)
    return data


def safe(fn, *a, **kw):
    try:
        return fn(*a, **kw), None
    except Exception as e:  # network, parse, 404 — never kill the whole brief
        return None, f"{type(e).__name__}: {e}"


# -------------------------------------------------------------- hebcal ----
def hebrew_date(g, use_cache):
    url = ("https://www.hebcal.com/converter?cfg=json&g2h=1"
           f"&gy={g.year}&gm={g.month}&gd={g.day}")
    d = get_json(url, use_cache)
    return {"hd": int(d["hd"]), "hm": d["hm"], "hy": int(d["hy"]),
            "hebrew": d.get("hebrew", ""), "events": d.get("events", [])}


def month_has_30(g, heb, use_cache):
    """If today is the 29th, peek at tomorrow to see whether a 30th exists."""
    if heb["hd"] != 29:
        return None
    nxt = hebrew_date(g + dt.timedelta(days=1), use_cache)
    return nxt["hd"] == 30


# ------------------------------------------------------------- sefaria ----
def sefaria_calendar(g, use_cache, diaspora=True):
    url = ("https://www.sefaria.org/api/calendars?"
           f"year={g.year}&month={g.month}&day={g.day}&diaspora={1 if diaspora else 0}")
    d = get_json(url, use_cache)
    items = {}
    for it in d.get("calendar_items", []):
        items[it["title"]["en"]] = it
    return items


SEGMENT = re.compile(r"^(.*) (\d+):(\d+)$")


def tanya_portion(ref, g, use_cache):
    """Today's whole Tanya reading as a range.

    Sefaria's calendar names only the paragraph a day's Tanya starts at
    ("Iggeret HaKodesh 25:1"); the reading runs up to the paragraph before
    the next day's start, or to the end of the chapter when tomorrow starts
    in another one. Falls back to the ref as given.
    """
    m = SEGMENT.match(ref)
    if not m:
        return ref
    book, chap, start = m.group(1), m.group(2), int(m.group(3))
    nxt, _ = safe(sefaria_calendar, g + dt.timedelta(days=1), use_cache)
    n = SEGMENT.match(((nxt or {}).get("Tanya Yomi") or {}).get("ref", ""))
    if n and n.group(1) == book and n.group(2) == chap and int(n.group(3)) > start:
        end = int(n.group(3)) - 1
    else:
        d, err = safe(get_json, "https://www.sefaria.org/api/v3/texts/"
                      + urllib.parse.quote(f"{book} {chap}") + "?version=hebrew&return_format=text_only",
                      use_cache)
        text = ((d or {}).get("versions") or [{}])[0].get("text") or []
        end = len(text) if isinstance(text, list) else 0
    return f"{book} {chap}:{start}-{end}" if end > start else ref


# Sefaria's default English for Rashi on the Torah covers few comments; this
# translation covers them all.
RASHI_EN = "Pentateuch with Rashi's commentary by M. Rosenbaum and A.M. Silbermann, 1929-1934"


def sefaria_text(ref, lang, use_cache, chapters=False, en_version=None):
    q = urllib.parse.quote(ref)
    en = "version=" + urllib.parse.quote("english|" + en_version) if en_version else "version=english"
    versions = {"he": "version=hebrew", "en": en, "both": "version=hebrew&" + en}[lang]
    url = f"https://www.sefaria.org/api/v3/texts/{q}?{versions}&return_format=text_only"
    d = get_json(url, use_cache)
    out = {"ref": d.get("ref", ref), "he": [], "en": []}
    for v in d.get("versions", []):
        key = "he" if v.get("language") == "he" else "en"
        out[key] = flatten(v.get("text", []))
        out[key + "_verses"] = by_verse(v.get("text", []))
        if chapters:
            out[key + "_chapters"] = by_chapter(v.get("text", []))
    return out


def by_chapter(x):
    """A range's paragraphs grouped by chapter: one list for a single chapter,
    one per chapter when it spans several (Rambam's 3 perakim)."""
    if not isinstance(x, list):
        return []
    if all(isinstance(c, list) for c in x):
        return [flatten(c) for c in x]
    return [flatten(x)]


def by_verse(x):
    """A commentary's text as one list of comments per verse.

    Sefaria nests a commentary range as verse -> comments, or chapter ->
    verse -> comments when it spans chapters; both come out as verse lists,
    in the order of the verses of the range.
    """
    if not isinstance(x, list) or not x:
        return []
    if all(isinstance(c, list) and all(isinstance(v, list) for v in c) for c in x):
        x = [v for c in x for v in c]  # chapters -> verses
    if not all(isinstance(v, list) for v in x):
        return []
    return [[strip_html(c) for c in flatten(v)] for v in x]


def daf_text(ref, lang, use_cache):
    """A daf as its amudim: [{"amud": "18a", "he": [...], "en": [...],
    "rashi_he": [[...], ...]}], Rashi grouped by the passage it comments on."""
    versions = {"he": "version=hebrew", "en": "version=english",
                "both": "version=hebrew&version=english"}[lang]
    d = get_json("https://www.sefaria.org/api/v3/texts/" + urllib.parse.quote(ref)
                 + f"?{versions}&return_format=text_only", use_cache)
    r = get_json("https://www.sefaria.org/api/v3/texts/" + urllib.parse.quote("Rashi on " + ref)
                 + "?version=hebrew&return_format=text_only", use_cache)

    def amudim(text):  # one list per amud, whether the ref spans one or two
        if not isinstance(text, list) or not text:
            return []
        return text if all(isinstance(a, list) for a in text) else [text]

    by = {"he": [], "en": []}
    for v in d.get("versions", []):
        by["he" if v.get("language") == "he" else "en"] = amudim(v.get("text", []))
    rashi = amudim(((r.get("versions") or [{}])[0]).get("text", []))
    first = (d.get("sections") or [""])[0]
    last = (d.get("toSections") or [first])[0]
    names = [first, last] if first != last else [first]
    out = []
    for i in range(max(len(by["he"]), len(by["en"]))):
        he = by["he"][i] if i < len(by["he"]) else []
        out.append({
            "amud": names[i] if i < len(names) else "",
            "he": [strip_html(x) for x in flatten(he)] if he and all(isinstance(x, str) for x in he) else flatten(he),
            "en": flatten(by["en"][i]) if i < len(by["en"]) else [],
            "rashi_he": by_verse(rashi[i]) if i < len(rashi) else [],
        })
    return out


def flatten(x):
    if isinstance(x, str):
        return [strip_html(x)] if x.strip() else []
    res = []
    for y in x:
        res.extend(flatten(y))
    return res


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", s).strip()


def sefaria_link(ref):
    return "https://www.sefaria.org/" + urllib.parse.quote(ref.replace(" ", "_"))


def chabad_links(g):
    t = f"{g.month}/{g.day}/{g.year}"
    base = "https://www.chabad.org/dailystudy/"
    return {
        "chumash": f"{base}torahreading.asp?tdate={t}",
        "tehillim": f"{base}tehillim.asp?tdate={t}",
        "tanya": f"{base}tanya.asp?tdate={t}",
        "rambam": f"{base}rambam.asp?tdate={t}",
        "hayom_yom": f"{base}hayomyom.asp?tdate={t}",
    }


# --------------------------------------------------------------- build ----
def build(g, args):
    use_cache = not args.no_cache
    errors = []
    brief = {"gregorian": g.isoformat(), "weekday": g.strftime("%A"), "sections": {}}

    heb, err = safe(hebrew_date, g, use_cache)
    if err:
        errors.append(f"hebcal: {err}")
    brief["hebrew"] = heb

    cal, err = safe(sefaria_calendar, g, use_cache)
    if err:
        errors.append(f"sefaria calendar: {err}")
        cal = {}

    links = chabad_links(g)
    S = brief["sections"]

    # --- Chumash + Rashi: the n-th aliyah of this week's parsha ---
    par = cal.get("Parashat Hashavua")
    if par:
        aliyot = (par.get("extraDetails") or {}).get("aliyot") or []
        wd = (g.weekday() + 1) % 7  # Mon=0 in python -> Sun=0 here
        ref = aliyot[wd] if wd < len(aliyot) else par["ref"]
        sec = {"parsha": par["displayValue"]["en"], "aliyah": ALIYAH_NAMES[wd],
               "ref": ref, "link": sefaria_link(ref), "chabad": links["chumash"]}
        if not args.refs:
            txt, err = safe(sefaria_text, ref, args.lang, use_cache)
            if err:
                errors.append(f"chumash text: {err}")
            sec["text"] = txt
            if not args.no_rashi:
                rashi, err = safe(sefaria_text, f"Rashi on {ref}", args.lang, use_cache, en_version=RASHI_EN)
                if err:
                    errors.append(f"rashi text: {err}")
                sec["rashi"] = rashi
        S["chumash"] = sec
    haf = cal.get("Haftarah")
    if haf:
        S["haftarah"] = {"ref": haf["ref"], "link": sefaria_link(haf["ref"])}

    # --- Tehillim: monthly cycle ---
    if heb:
        hd = heb["hd"]
        chapters = TEHILLIM[hd]
        if hd == 29:
            has30, _ = safe(month_has_30, g, heb, use_cache)
            if has30 is False:
                chapters = "140-150"
        ref = f"Psalms {chapters}"
        S["tehillim"] = {"day_of_month": hd, "ref": ref,
                         "link": sefaria_link(ref), "chabad": links["tehillim"]}
        if args.full:
            S["tehillim"]["text"] = safe(sefaria_text, ref, args.lang, use_cache)[0]

    # --- Tanya ---
    tanya = cal.get("Tanya Yomi")
    if tanya:
        ref = tanya_portion(tanya["ref"], g, use_cache)
        S["tanya"] = {"ref": ref, "display": tanya["displayValue"]["en"],
                      "link": sefaria_link(ref), "chabad": links["tanya"]}
        if args.full:
            S["tanya"]["text"] = safe(sefaria_text, ref, args.lang, use_cache)[0]
    else:
        S["tanya"] = {"ref": None, "chabad": links["tanya"]}

    # --- Rambam ---
    r3 = cal.get("Daily Rambam (3 Chapters)")
    r1 = cal.get("Daily Rambam")
    S["rambam"] = {
        "three_perakim": r3 and {"ref": r3["ref"], "display": r3["displayValue"]["en"],
                                 "link": sefaria_link(r3["ref"])},
        "one_perek": r1 and {"ref": r1["ref"], "display": r1["displayValue"]["en"],
                             "link": sefaria_link(r1["ref"])},
        "chabad": links["rambam"],
    }
    if args.full:
        for key, r in (("three_perakim", r3), ("one_perek", r1)):
            if r:
                txt, err = safe(sefaria_text, r["ref"], args.lang, use_cache, True)
                if err:
                    errors.append(f"rambam {key.replace('_', ' ')} text: {err}")
                S["rambam"][key]["text"] = txt

    # --- Hayom Yom ---
    if heb:
        month = HEB_MONTH.get(heb["hm"], heb["hm"])
        ref = f"Hayom Yom, {month} {heb['hd']}"
        sec = {"ref": ref, "link": sefaria_link(ref), "chabad": links["hayom_yom"]}
        if not args.refs:
            txt, err = safe(sefaria_text, ref, args.lang, use_cache)
            if err:
                errors.append(f"hayom yom text: {err} (use the chabad link)")
            sec["text"] = txt
        S["hayom_yom"] = sec

    # --- Daf Yomi: both amudim, each passage with its Rashi ---
    daf = cal.get("Daf Yomi")
    if daf:
        S["daf_yomi"] = {"ref": daf["ref"], "display": daf["displayValue"]["en"],
                         "link": sefaria_link(daf["ref"])}
        if args.full:
            amudim, err = safe(daf_text, daf["ref"], args.lang, use_cache)
            if err:
                errors.append(f"daf yomi text: {err}")
            S["daf_yomi"]["amudim"] = amudim or []

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
        L.append(f"- Tanya: {ta.get('chabad')}")

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
            L.append(f"  {hy['chabad']}")

    d = S.get("daf_yomi")
    if d:
        L.append(f"- Daf Yomi: {d['display']}")
        L.append(f"  {d['link']}")
        for a in d.get("amudim") or []:
            L.append(f"  [{a['amud']}]")
            L.extend(render_text(a, args.lang))

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
