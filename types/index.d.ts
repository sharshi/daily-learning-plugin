// State contract for the chitas mod: the values the sidebar pane draws from.

export type TabId = "chumash" | "rashi" | "tehillim" | "tanya" | "rambam" | "hayom";
export type Lang = "he" | "en" | "both";

// One block of text in a tab: a ref, its links, and parallel he/en paragraphs.
export type Part = { title: string; link?: string; chabad?: string; he: string[]; en: string[] };

export type Day = {
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
      lang: Lang;
      nikkud: boolean;
      // Draw Hebrew in visual (reversed) order for terminals without bidi.
      // null = automatic: on in the terminal, off on surfaces that do bidi.
      flip: boolean | null;
    };
  }
}
