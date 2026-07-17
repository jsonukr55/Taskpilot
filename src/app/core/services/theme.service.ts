import { Injectable, inject, signal, effect } from '@angular/core';
import { AuthService } from './auth.service';

// ============================================================
// ThemeService — Dark/Light mode + runtime accent color
// ============================================================

export type Theme = 'light' | 'dark' | 'system';

export interface AccentPreset {
  name:  string;
  color: string;   // hex
}

/** ClickUp-style accent palette. First entry is the default. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Indigo',  color: '#6366f1' },
  { name: 'Violet',  color: '#8b5cf6' },
  { name: 'Blue',    color: '#3b82f6' },
  { name: 'Sky',     color: '#0ea5e9' },
  { name: 'Teal',    color: '#14b8a6' },
  { name: 'Emerald', color: '#10b981' },
  { name: 'Lime',    color: '#84cc16' },
  { name: 'Amber',   color: '#f59e0b' },
  { name: 'Orange',  color: '#f97316' },
  { name: 'Rose',    color: '#f43f5e' },
  { name: 'Pink',    color: '#ec4899' },
  { name: 'Slate',   color: '#64748b' },
];

const DEFAULT_ACCENT = ACCENT_PRESETS[0].color;

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly auth = inject(AuthService);

  readonly currentTheme  = signal<Theme>('system');
  readonly resolvedTheme = signal<'light' | 'dark'>('light');
  readonly accentColor   = signal<string>(DEFAULT_ACCENT);

  /** Appearance popover visibility — shared so the command palette can open it. */
  readonly appearanceOpen = signal(false);

  readonly presets = ACCENT_PRESETS;

  private mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    // Apply the stored accent immediately (avoids a flash on first paint).
    this.applyAccent(DEFAULT_ACCENT);

    // Listen to system preference changes
    this.mediaQuery.addEventListener('change', () => {
      if (this.currentTheme() === 'system') {
        this.applyTheme('system');
      }
    });

    // Sync with user preferences
    effect(() => {
      const prefs = this.auth.userProfile()?.preferences;
      if (prefs?.theme) {
        this.setTheme(prefs.theme);
      }
      if (prefs?.accentColor) {
        this.setAccent(prefs.accentColor, false);
      }
    }, { allowSignalWrites: true });
  }

  // ---- Theme mode ------------------------------------------------

  setTheme(theme: Theme): void {
    this.currentTheme.set(theme);
    this.applyTheme(theme);
  }

  private applyTheme(theme: Theme): void {
    const isDark = theme === 'dark' ||
      (theme === 'system' && this.mediaQuery.matches);

    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    this.resolvedTheme.set(isDark ? 'dark' : 'light');

    // Update meta theme-color for mobile browsers
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', isDark ? '#18181a' : '#f8fafc');
    }
  }

  toggle(): void {
    const next = this.resolvedTheme() === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
    this.auth.updatePreferences({ theme: next });
  }

  // ---- Accent color ----------------------------------------------

  /**
   * Set the app-wide accent color. Writes `--accent-500` + `--accent-rgb`
   * onto the document root; all other shades derive via CSS color-mix.
   * @param persist when true, saves to the user's profile.
   */
  setAccent(hex: string, persist = true): void {
    const normalized = this.normalizeHex(hex);
    if (!normalized) return;

    this.accentColor.set(normalized);
    this.applyAccent(normalized);

    if (persist) {
      this.auth.updatePreferences({ accentColor: normalized });
    }
  }

  private applyAccent(hex: string): void {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return;
    const root = document.documentElement;
    root.style.setProperty('--accent-500', hex);
    root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  }

  private normalizeHex(hex: string): string | null {
    let h = hex.trim().toLowerCase();
    if (!h.startsWith('#')) h = '#' + h;
    // Expand shorthand #abc -> #aabbcc
    if (/^#[0-9a-f]{3}$/.test(h)) {
      h = '#' + h.slice(1).split('').map(c => c + c).join('');
    }
    return /^#[0-9a-f]{6}$/.test(h) ? h : null;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const h = this.normalizeHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }
}
