import { Injectable, inject, signal, effect } from '@angular/core';
import { AuthService } from './auth.service';

// ============================================================
// ThemeService — Dark/Light mode with system detection
// ============================================================

export type Theme = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly auth = inject(AuthService);

  readonly currentTheme  = signal<Theme>('system');
  readonly resolvedTheme = signal<'light' | 'dark'>('light');

  private mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
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
    }, { allowSignalWrites: true });
  }

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
      meta.setAttribute('content', isDark ? '#0f0f14' : '#f8fafc');
    }
  }

  toggle(): void {
    const next = this.resolvedTheme() === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
    this.auth.updatePreferences({ theme: next });
  }
}
