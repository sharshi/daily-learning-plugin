// State contract for the chitas mod: the values the sidebar pane draws from.

export type TabId = "chumash" | "tehillim" | "tanya" | "rambam1" | "rambam3" | "hayom";

// One block of text in a tab: a ref, its links, and parallel he/en paragraphs.
// `rashi` holds Rashi's comments per verse, aligned with `he` (Chumash only).
export type Part = {
  title: string; link?: string; chabad?: string; he: string[]; en: string[];
  rashi?: { he: string[][]; en: string[][] };
  // Rambam: the halachot grouped by chapter, `n` the chapter's number.
  chapters?: { n: number; he: string[]; en: string[] }[];
};

export type Day = {
  v: number; // shape version: a cached Day of another version is fetched again
  key: string; // Gregorian YYYY-MM-DD
  title: string; // "Tuesday 2026-10-06 · 25 Tishrei 5787"
  hebrew: string; // Hebrew date in Hebrew letters
  parts: Record<TabId, Part[]>;
  errors: string[];
};

export type Status = { key: string; phase: "loading" | "ready" | "error"; error?: string };

declare module "claude-code" {
  interface PluginState {
    chitas: {
      day: Day | null;
      status: Status | null;
      tab: TabId;
      english: boolean;
      nikkud: boolean;
      // Draw Hebrew in visual (reversed) order for terminals without bidi.
      // null = automatic: on in the terminal, off on surfaces that do bidi.
      flip: boolean | null;
      // Which perek of a multi-chapter Rambam reading is showing, for which day.
      perek: { key: string; i: number } | null;
    };
  }
}
