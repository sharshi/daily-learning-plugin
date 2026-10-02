# chitas-cc-mod

A [Claude Code mod](https://docs.claude.com/en/docs/claude-code/overview) that shows the day's learning above the prompt — Chitas (Chumash aliyah, Tehillim, Tanya), Rambam, Hayom Yom, Daf Yomi — and a `/chitas` command that prints the full text with Rashi.

```
✡ 21 Tishrei 5787 · Hoshana Raba   /chitas for text
Chumash    V'Zot HaBerachah · Shishi (Deuteronomy 33:27-29)
Tehillim   104-105  (day 21)
Tanya      Igeret HaKodesh 27…
Rambam ×3  Hilchot …
Rambam ×1  Hilchot …
Hayom Yom  Tishrei 21
Daf Yomi   …
```

## Install

Requires Claude Code ≥ 2.1.287 (mods), Node 18+ (global `fetch`), Python 3 for `/chitas`.

```sh
git clone https://github.com/sharshi/chitas-cc-mod
claude --plugin-dir ./chitas-cc-mod
```

## Commands

| Command | What it does |
|---|---|
| `/chitas` | Full Chumash aliyah + Rashi, Hayom Yom text; refs for the rest |
| `/chitas --full` | Text for Tehillim, Tanya and Rambam too |
| `/chitas --refs` | One-screen refs + links |
| `/chitas --after-sunset` | Roll to the next Hebrew day |
| `/chitas --date 2026-10-05` | Any date |
| `/chitas --lang he` | `he`, `en` or `both` (default) |
| `/chitas-toggle` | Collapse the panel to one line |

`scripts/chitas.py` also works standalone (`--json` for machine output).

## Sources

- Hebrew date: [hebcal.com](https://www.hebcal.com/home/developer-apis) converter API
- Calendar refs and texts: [Sefaria API](https://developers.sefaria.org/) (`/api/calendars`, `/api/v3/texts`)
- Tehillim follows the Chabad monthly cycle; 29/30-day months and the Psalm 119 split are handled
- Every section links to the matching [chabad.org daily study](https://www.chabad.org/dailystudy) page as a fallback

Responses are cached per day in `~/.cache/chitas/`.

## Layout

```
.claude-plugin/plugin.json   manifest
hooks/hooks.json             → ["./register.js"]
hooks/register.js            AbovePrompt panel + /chitas-toggle
commands/chitas.md           /chitas slash command
scripts/chitas.py            fetch + render (stdlib only)
```

## Status

Early. The mods API is still changing between Claude Code releases; run `/plugin-types` and adjust `register.js` if the `ui.render` or command event shapes differ on your version. Issues and PRs welcome.

## License

MIT
