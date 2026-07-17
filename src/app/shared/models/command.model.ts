// ============================================================
// Command Palette Models
// ============================================================

/** A single actionable row in the command palette. */
export interface PaletteRow {
  id:        string;
  title:     string;
  subtitle?: string;
  /** tp-icon name (used when no emoji). */
  icon:      string;
  /** Entity emoji, rendered as text when present. */
  emoji?:    string;
  /** Section heading this row appears under. */
  group:     string;
  /** Executed immediately when the row is chosen. */
  run:       () => void | Promise<unknown>;
}

/** A registered command (source for palette rows). */
export interface PaletteCommand {
  id:        string;
  title:     string;
  subtitle?: string;
  icon:      string;
  emoji?:    string;
  group:     string;
  /** Extra text matched by the fuzzy filter. */
  keywords?: string;
  /** Shown in the default (empty-query) view. */
  primary?:  boolean;
  run:       () => void | Promise<unknown>;
}

export interface PaletteGroup {
  label: string;
  rows:  PaletteRow[];
}
