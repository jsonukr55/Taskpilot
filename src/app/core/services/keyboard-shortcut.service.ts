import { Injectable, signal, computed, Signal } from '@angular/core';
import { Shortcut, ShortcutView } from '@shared/models/keyboard.model';

// ============================================================
// KeyboardShortcutService
// ------------------------------------------------------------
// A single, reusable keyboard-shortcut registry for the whole app.
// Components register shortcuts on init and unregister on destroy
// (the register() call returns its own disposer).
//
// Key rules:
//  • ONE global keydown listener, installed once.
//  • Single-key shortcuts NEVER fire while typing in an input /
//    textarea / contenteditable — only Escape and explicitly
//    `allowInInput` shortcuts do. This is the "must never interfere
//    with typing" guarantee.
//  • 'mod' abstracts Ctrl (Win/Linux) and Cmd (macOS).
//  • The most-recently-registered matching shortcut wins, so a modal
//    or drawer opened later naturally takes priority (e.g. Escape).
// ============================================================

interface Registration extends Shortcut {
  combos: string[];   // normalized
  seq:    number;     // registration order (higher = newer = higher priority)
}

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService {
  private readonly regs = signal<Registration[]>([]);
  private seqCounter = 0;
  private listening = false;

  /** Whether the shortcuts help overlay is open (toggled by '?'). */
  readonly helpOpen = signal(false);

  constructor() {
    this.ensureListening();
  }

  /** Register a shortcut. Returns a disposer to unregister it. */
  register(shortcut: Shortcut): () => void {
    const combos = (Array.isArray(shortcut.keys) ? shortcut.keys : [shortcut.keys])
      .map(normalizeCombo);
    const reg: Registration = { ...shortcut, combos, seq: ++this.seqCounter };
    this.regs.update(list => [...list, reg]);
    return () => this.regs.update(list => list.filter(r => r !== reg));
  }

  /** Register several shortcuts at once; returns one disposer for all. */
  registerAll(shortcuts: Shortcut[]): () => void {
    const disposers = shortcuts.map(s => this.register(s));
    return () => disposers.forEach(d => d());
  }

  /** Documented shortcuts, grouped, for the help overlay. */
  readonly documented: Signal<ShortcutView[]> = computed(() =>
    this.regs()
      .filter(r => r.description)
      .map(r => ({ keys: r.combos, description: r.description!, group: r.group ?? 'General' }))
  );

  toggleHelp(): void { this.helpOpen.update(v => !v); }

  // ---- Global dispatch ------------------------------------------------

  private ensureListening(): void {
    if (this.listening || typeof document === 'undefined') return;
    this.listening = true;
    document.addEventListener('keydown', e => this.onKeydown(e));
  }

  private onKeydown(e: KeyboardEvent): void {
    // A closer handler (e.g. a custom dropdown) already consumed this key.
    if (e.defaultPrevented) return;
    // Ignore lone modifier presses.
    if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Shift' || e.key === 'Alt') return;

    const combo    = eventCombo(e);
    const editable = isEditable(e.target);

    // Newest registrations first (higher priority).
    const ordered = [...this.regs()].sort((a, b) => b.seq - a.seq);
    for (const reg of ordered) {
      if (!reg.combos.includes(combo)) continue;
      if (editable && combo !== 'escape' && !reg.allowInInput) continue;
      if (reg.when && !reg.when()) continue;

      const result = reg.handler(e);
      if (result !== false) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;   // one shortcut per keystroke
    }
  }
}

// ---- Combo normalization (module-private, pure) ----------------------

const MOD_TOKENS = new Set(['mod', 'ctrl', 'control', 'cmd', 'command', 'meta']);
const NAMED_KEYS = new Set([
  'escape', 'enter', 'tab', 'space', 'backspace', 'delete',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end',
]);

function normalizeToken(t: string): string {
  const x = t.trim().toLowerCase();
  if (MOD_TOKENS.has(x)) return 'mod';
  if (x === 'esc')   return 'escape';
  if (x === 'del')   return 'delete';
  if (x === ' ')     return 'space';
  return x;
}

/** Build a canonical combo string: mod+alt+shift+key (in that order). */
function buildCombo(mod: boolean, alt: boolean, shift: boolean, key: string): string {
  const parts: string[] = [];
  if (mod)   parts.push('mod');
  if (alt)   parts.push('alt');
  if (shift) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

function normalizeCombo(combo: string): string {
  const tokens = combo.split('+').map(normalizeToken);
  const key = tokens.find(t => t !== 'mod' && t !== 'alt' && t !== 'shift') ?? '';
  return buildCombo(tokens.includes('mod'), tokens.includes('alt'), tokens.includes('shift'), key);
}

function eventCombo(e: KeyboardEvent): string {
  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';

  // Only treat Shift as a modifier for alphanumerics / named keys. For
  // shifted punctuation ('?', ':' …) the symbol already implies Shift,
  // so we drop it — that's how '?' registers cleanly.
  const isNamedOrAlnum = key.length > 1 ? NAMED_KEYS.has(key) : /^[a-z0-9]$/.test(key);
  const shift = e.shiftKey && isNamedOrAlnum;

  return buildCombo(e.ctrlKey || e.metaKey, e.altKey, shift, key);
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
