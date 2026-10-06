// State contract for the dl (Daily Learning) mod: the values the sidebar pane draws from.

export type TabId = "chumash" | "tehillim" | "tanya" | "rambam1" | "rambam3" | "hayom" | "daf";

// One block of text in a tab: a ref, its links, and parallel he/en paragraphs.
// `rashi` holds Rashi's comments per verse, aligned with `he` (Chumash only).
export type Part = {
  title: string; link?: string; chabad?: string; he: string[]; en: string[];
  rashi?: { he: string[][]; en: string[][] };
  // A reading read one section at a time (Rambam's perakim, the daf's amudim):
  // `unit` names them in the next/previous buttons, `numbered` leads each
  // paragraph with its number (a halacha's א.), and `rashi` is per paragraph.
  sections?: Section[];
  unit?: "perek" | "amud";
  numbered?: boolean;
};

// One section: `name` heads it (פרק יב, דף יח.), `short` names it in a button (יב, יח.).
export type Section = { name: string; short: string; he: string[]; en: string[]; rashi?: string[][] };

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
    dl: {
      day: Day | null;
      status: Status | null;
      tab: TabId;
      english: boolean;
      nikkud: boolean;
      // Which section (perek, amud) each sectioned tab shows, for which day.
      perek: { key: string; at: Partial<Record<TabId, number>> } | null;
    };
  }
}
