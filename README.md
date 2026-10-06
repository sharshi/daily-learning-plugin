# chitas-cc-mod

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) for the daily learning: Chitas (Chumash with Rashi, Tehillim, Tanya), Rambam (1 and 3 perakim), Hayom Yom and Daf Yomi.

- **One line above the prompt** with today's Hebrew date and the day's sections. Click a section to open its text; click **×** to hide the line until tomorrow.
- **A sidebar** (`/chitas-pane`) with the full Hebrew text, laid out right to left:
  - Chumash with each verse's Rashi under it
  - Tehillim on the Chabad monthly cycle
  - The whole day's Tanya portion
  - Rambam ×1 and Rambam ×3, one perek at a time, each halacha numbered **א. ב. ג.**
  - Hayom Yom, when Sefaria has its text
  - English is a toggle; nikkud is a toggle; te'amim are left out.
- **`/chitas`** prints the day's text into the conversation, where you can ask Claude about it.

```
✡ 25 Tishrei 5787 · Parashat Bereshit  Chumash  Tehillim  Tanya  Rambam ×3  Rambam ×1  Hayom Yom  Daf Yomi Bekhorot 18  ×
```

## Install

Requires Claude Code 2.1.286 or later (mods) and `python3` (for the sidebar text and `/chitas`).

In a Claude Code session:

```
/plugin marketplace add sharshi/chitas-cc-mod
/plugin install chitas@chitas-cc-mod
```

Or try it for one session from a clone: `claude --plugin-dir ./chitas-cc-mod`.

## Use

| Command | What it does |
|---|---|
| `/chitas-pane` | Open the sidebar |
| `/chitas-toggle` | Hide the line above the prompt for today, or bring it back (the × on the line hides it too) |
| `/chitas` | Print the text in the conversation (`--refs`, `--full`, `--after-sunset`, `--date 2026-10-05`, `--lang he\|en\|both`) |

In the sidebar:

| Key | |
|---|---|
| `1`–`6` | Switch tab (sections with no text that day are left out) |
| `e` | English on or off |
| `n` | Nikkud on or off |
| `j` / `k` | Next / previous perek in Rambam ×3 |
| `↑` `↓` | Scroll |
| `Esc` | Back to the prompt |

### Setting: Hebrew font

In `/config`, under chitas, **Hebrew font** can be set to **Shlomo SemiStam**: the mod installs the bundled font for your user and, in Ghostty, maps the Hebrew block to it (`font-codepoint-map = U+0590-U+05FF=Ezra SIL SR` in your Ghostty config; reload it with cmd+shift+,). Setting it back to **Terminal default** removes that line. Other terminals keep their own fonts.

## Terminals

Terminals draw Hebrew in different ways, so the sidebar lays it out per terminal:

| Where | How it reads |
|---|---|
| **Ghostty**, and other terminals without right-to-left support | Best. The mod places every letter itself. |
| **Claude Desktop** (Code tab) | The app lays out Hebrew itself, so the mod sends it in reading order. |
| **macOS Terminal** | Best effort. Terminal reorders Hebrew on its own, and where Claude Code repaints part of the screen it can leave stray letters behind; nikkud on a line's first letter can break. Press `n` to drop nikkud, or use Ghostty. |

## Sources

- Hebrew date: [hebcal.com](https://www.hebcal.com/home/developer-apis) converter API
- Calendar and texts: [Sefaria API](https://developers.sefaria.org/) (`/api/calendars`, `/api/v3/texts`)
- Tanya: Sefaria's calendar names only where each day's reading starts, so the mod reads up to where the next day's starts
- Tehillim follows the Chabad monthly cycle, including 29-day months and the Psalm 119 split
- Sections link to [chabad.org daily study](https://www.chabad.org/dailystudy) as a fallback

`scripts/chitas.py` caches API responses in `~/.cache/chitas/` (delete it any time); the mod keeps only today's text, in its own store.

## Develop

```
.claude-plugin/        plugin.json (manifest, Hebrew font setting) and marketplace.json
hooks/register.tsx     the mod: band, sidebar, commands, fetching
hooks/data.ts          the day's data shaped for drawing (pure)
hooks/hebrew.ts        Hebrew cleanup, mark order, wrapping and right-to-left ordering (pure)
types/index.d.ts       the sidebar's $.state contract
commands/chitas.md     /chitas
scripts/chitas.py      fetches the day's refs and text (stdlib only; also works standalone, --json)
scripts/install-font.sh  applies the Hebrew font setting
fonts/                 Shlomo SemiStam and its license
tests/                 claude plugin test suites, with one day's data as a fixture
```

```sh
claude --plugin-dir .          # run it; edits apply on /reload-plugins
claude plugin validate .       # what the mod hooks and calls, and anything the engine would refuse
claude plugin test .           # the test suites
npx -p typescript tsc -p .     # type-check (after one --plugin-dir run writes .claude-plugin/types)
```

An installed copy (`/plugin install`) is a snapshot: bump `version` in `.claude-plugin/plugin.json` and run `claude plugin update chitas@chitas-cc-mod` to refresh it.

## License

The code is MIT; see [LICENSE](LICENSE). The bundled Shlomo SemiStam font is © SIL International and Shlomo Orbach under the SIL Open Font License 1.1; see [fonts/](fonts/).
