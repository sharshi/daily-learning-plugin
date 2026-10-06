# Daily Learning Plugin

**[Website](https://www.sharshi.com/daily-learning-plugin/)** · A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) (`dl`) for the daily learning: Chitas (Chumash with Rashi, Tehillim, Tanya), Rambam (1 and 3 perakim), Hayom Yom and Daf Yomi.

## Install

In a Claude Code session, run:

```
/plugin marketplace add sharshi/daily-learning-plugin
/plugin install dl@daily-learning
```

Then `/dl` opens the sidebar. Requires Claude Code 2.1.286 or later and `python3`. To try it for one session from a clone instead: `claude --plugin-dir ./daily-learning-plugin`.

<img width="1377" height="1027" alt="Screenshot 2026-10-06 at 1 31 27 PM" src="https://github.com/user-attachments/assets/2ac93e6f-2334-4886-beb0-071f204dd5ad" />

## What it does

<img width="1377" height="1027" alt="Screenshot 2026-10-06 at 1 31 27 PM" src="https://github.com/user-attachments/assets/cc3e375f-ae6d-4b2f-9aa0-e33c699e71f6" />

- **One line above the prompt** with today's Hebrew date and the day's sections. Click a section to open its text; click **×** to hide the line until tomorrow.
- **A sidebar** (`/dl`) with the full Hebrew text, laid out right to left:
  - Chumash with each verse's Rashi under it
  - Tehillim on the Chabad monthly cycle
  - The whole day's Tanya portion
  - Rambam ×1 and Rambam ×3, one perek at a time, each halacha numbered **א. ב. ג.**
  - Daf Yomi, one amud at a time, each passage with its Rashi
  - Hayom Yom, when Sefaria has its text
  - English off, **staggered** (under each paragraph) or **side by side** (English left, Hebrew right), Rashi's included (Rosenbaum & Silbermann's translation; Sefaria has no English for Rashi on the Gemara); nikkud and Rashi can be turned off; te'amim are left out.
  - A **⚙ settings** page for font, English, nikkud, Rashi and text size.
  - In the terminal, the date, tabs and toggles stay at the top as the text scrolls.
- **`/dl:text`** prints the day's text into the conversation, where you can ask Claude about it.

```
✡ 25 Tishrei 5787 · Parashat Bereshit  Chumash  Tehillim  Tanya  Rambam ×3  Rambam ×1  Daf Yomi  ×
```

## Use

| Command | What it does |
|---|---|
| `/dl` | Open the sidebar |
| `/dl-toggle` | Hide the line above the prompt for today, or bring it back (the × on the line hides it too) |
| `/dl:text` | Print the text in the conversation (`--refs`, `--full`, `--after-sunset`, `--date 2026-10-05`, `--lang he\|en\|both`) |

In the sidebar:

| Key | |
|---|---|
| `1`–`7` | Switch tab (sections with no text that day are left out) |
| `e` | English: off → staggered → side by side |
| `n` | Nikkud on or off |
| `s` | Settings page, or back to the text |
| `j` / `k` | Next / previous perek (Rambam ×3) or amud (Daf Yomi) |
| `↑` `↓` | Scroll |
| `Esc` | Back to the prompt |

### Settings

The sidebar's **⚙ settings** page (`s`) sets these; they're also in `/config` under dl, and they last across sessions.

| Setting | Choices |
|---|---|
| Hebrew font | **Frank Ruhl** (Frank Ruhl Libre, the default) or **Shlomo**, both bundled with nikkud; **System** leaves every font alone |
| English | Off, Staggered, Side by side |
| Nikkud | On, Off |
| Rashi | On, Off |
| Text size | Small, Medium, Large (the Desktop app; a terminal uses its own size) |

The Hebrew font is embedded in the Desktop app's pages. For **Ghostty** it is installed for your user and Ghostty's Hebrew is mapped to it, with one marked line in your Ghostty config (reload it with cmd+shift+,); a Hebrew mapping you wrote yourself is left alone, and **System** removes the mod's line. **macOS Terminal** has no way to use a separate Hebrew font, so it keeps its own.

## Terminals

Terminals draw Hebrew in different ways, so the sidebar lays it out per terminal:

| Where | How it reads |
|---|---|
| **Ghostty**, and other terminals without right-to-left support | Best. The mod places every letter itself. |
| **Claude Desktop** (Code tab) | Best. With a Hebrew font chosen, each reading is drawn as one image with that font built in, laid out by the app's own text engine (you can't select text inside it); with System, as text. |
| **macOS Terminal** | Best effort. Terminal reorders Hebrew on its own, and where Claude Code repaints part of the screen it can leave stray letters behind; nikkud on a line's first letter can break. Press `n` to drop nikkud, or use Ghostty. |

## Sources

- Hebrew date: [hebcal.com](https://www.hebcal.com/home/developer-apis) converter API
- Calendar and texts: [Sefaria API](https://developers.sefaria.org/) (`/api/calendars`, `/api/v3/texts`)
- Tanya: Sefaria's calendar names only where each day's reading starts, so the mod reads up to where the next day's starts
- Tehillim follows the Chabad monthly cycle, including 29-day months and the Psalm 119 split
- Sections link to [chabad.org daily study](https://www.chabad.org/dailystudy) as a fallback

`scripts/dl.py` caches API responses in `~/.cache/daily-learning/` (delete it any time); the mod keeps only today's text, in its own store.

## Develop

```
.claude-plugin/        plugin.json (manifest, Hebrew font setting) and marketplace.json
hooks/register.tsx     the mod: band, sidebar, commands, fetching
hooks/data.ts          the day's data shaped for drawing (pure)
hooks/hebrew.ts        Hebrew cleanup, mark order, wrapping and right-to-left ordering (pure)
hooks/svg.ts           the Desktop app's page: one SVG with the font embedded (pure)
hooks/font-metrics.ts  the font's letter widths, for wrapping (generated)
types/index.d.ts       the sidebar's $.state contract
commands/text.md       /dl:text
scripts/dl.py          fetches the day's refs and text (stdlib only; also works standalone, --json)
scripts/install-font.sh  applies the Hebrew font setting
scripts/make-woff.py   builds the fonts' .woff files and hooks/font-metrics.ts from the .ttf files
fonts/                 Shlomo and Frank Ruhl Libre (.ttf, and .woff for the Desktop app) and their licenses
tests/                 claude plugin test suites, with one day's data as a fixture
```

```sh
claude --plugin-dir .          # run it; edits apply on /reload-plugins
claude plugin validate .       # what the mod hooks and calls, and anything the engine would refuse
claude plugin test .           # the test suites
npx -p typescript tsc -p .     # type-check (after one --plugin-dir run writes .claude-plugin/types)
```

An installed copy (`/plugin install`) is a snapshot: bump `version` in `.claude-plugin/plugin.json` and run `claude plugin update dl@daily-learning` to refresh it.

## License

The code is MIT; see [LICENSE](LICENSE). The bundled fonts are under the SIL Open Font License 1.1: Shlomo © SIL International and Shlomo Orbach, Frank Ruhl Libre © The Frank Ruhl Libre Project Authors; see [fonts/](fonts/).
