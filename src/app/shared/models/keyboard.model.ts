// ============================================================
// Keyboard Shortcut Models
// ============================================================

/**
 * A registered keyboard shortcut.
 *
 * `keys` uses a simple combo grammar: tokens joined by '+', where
 * 'mod' means Ctrl (Windows/Linux) OR Cmd (macOS). Examples:
 *   'mod+k', 'mod+s', 'n', '/', 'Escape', 'ArrowDown', 'shift+?'.
 * Pass an array to bind several combos to one handler.
 */
export interface Shortcut {
  /** Optional stable id (dedupe / debugging). */
  id?:          string;
  keys:         string | string[];
  /** Return `false` to skip preventDefault; anything else consumes the event. */
  handler:      (e: KeyboardEvent) => void | boolean;
  /** Guard — the shortcut only fires when this returns true. */
  when?:        () => boolean;
  /**
   * Allow firing while a text input / textarea / contenteditable is focused.
   * Default false so single-key shortcuts never interfere with typing.
   * (Escape is always allowed regardless of this flag.)
   */
  allowInInput?: boolean;
  /** Human label for the help overlay (omit to hide from help). */
  description?: string;
  /** Grouping bucket in the help overlay, e.g. 'Global', 'Tasks'. */
  group?:       string;
}

/** A shortcut projected for display in the help overlay. */
export interface ShortcutView {
  keys:        string[];   // normalized combos, e.g. ['mod+k']
  description: string;
  group:       string;
}
