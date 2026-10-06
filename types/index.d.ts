// State contract for the dl (Daily Learning) mod: the values the sidebar pane draws from.

// The Library's collections, and their structure as Sefaria's shape API gives
// it: sections (sedarim, sefarim) of books (masechtos, hilchos), each with its
// first and last unit (perek, or daf).
export type Coll = "mishnah" | "bavli" | "mt";
export type LibBook = { title: string; he: string; name: string; section: string; first: number; last: number };
export type LibSection = { name: string; he: string; books: LibBook[] };
export type LibShape = { sections: LibSection[] };
// Where the reader is: a collection, a section, a book, a unit.
export type LibPos = { coll?: Coll; section?: string; book?: string; unit?: number };

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
      // Which page the sidebar shows: the day's text, its settings, or the Library.
      page: "read" | "settings" | "library";
      // The Library: where the menu is, the collections loaded so far, the unit
      // open (its ref and text), what is loading, and where each collection
      // was last read.
      libPos: LibPos;
      libShapes: Partial<Record<Coll, LibShape>>;
      libText: { ref: string; part: Part } | null;
      libStatus: { what: string; phase: "loading" | "error"; error?: string } | null;
      libLast: Partial<Record<Coll, { book: string; unit: number }>>;
      // Which section (perek, amud) each sectioned tab shows, for which day.
      perek: { key: string; at: Partial<Record<TabId, number>> } | null;
    };
  }
}
