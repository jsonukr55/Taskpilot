import { Injectable, inject, signal, computed } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { ThemeService, ACCENT_PRESETS } from './theme.service';
import { NoteService } from './note.service';
import { SearchService } from './search.service';
import { KeyboardShortcutService } from './keyboard-shortcut.service';
import { PaletteCommand, PaletteRow, PaletteGroup } from '@shared/models/command.model';
import { SearchResult, scoreEntity } from '@shared/models/search.model';

// Top-level destinations (Navigate commands + recent-page labels).
const NAV: { route: string; label: string; icon: string }[] = [
  { route: '/dashboard',  label: 'Dashboard',    icon: 'grid' },
  { route: '/tasks',      label: 'Tasks',        icon: 'check-square' },
  { route: '/notes',      label: 'Notes',        icon: 'file-text' },
  { route: '/groups',     label: 'Groups',       icon: 'users' },
  { route: '/daily',      label: 'Daily Report', icon: 'check-circle' },
  { route: '/calendar',   label: 'Calendar',     icon: 'calendar' },
  { route: '/categories', label: 'Categories',   icon: 'folder' },
  { route: '/analytics',  label: 'Analytics',    icon: 'bar-chart-2' },
  { route: '/ai-chat',    label: 'AI Assistant', icon: 'cpu' },
  { route: '/whats-new',  label: "What's New",   icon: 'sparkles' },
];

const RECENT_LIMIT = 4;

// ============================================================
// CommandPaletteService
// ------------------------------------------------------------
// The ⌘K / Ctrl+K command palette. Combines quick commands
// (Navigate, Create, Actions, Theme) with live entity results
// (reusing SearchService's fuzzy engine) and Recent Pages. Every
// row executes immediately on selection.
// ============================================================
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly router = inject(Router);
  private readonly theme  = inject(ThemeService);
  private readonly notes  = inject(NoteService);
  private readonly search = inject(SearchService);
  private readonly kb     = inject(KeyboardShortcutService);

  readonly open        = signal(false);
  readonly query       = signal('');
  readonly activeIndex = signal(0);

  private readonly recent = signal<string[]>([]);   // recent top-level routes

  constructor() {
    // Track recent top-level pages.
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => {
      const url = (e as NavigationEnd).urlAfterRedirects.split('?')[0];
      const nav = NAV.find(n => n.route === url);
      if (nav) this.recent.update(list => [nav.route, ...list.filter(r => r !== nav.route)].slice(0, RECENT_LIMIT));
    });

    // Global shortcut.
    this.kb.register({
      keys: 'mod+k', description: 'Command palette', group: 'Global', allowInInput: true,
      handler: () => this.toggle(),
    });
  }

  // ---- Open / close ---------------------------------------------------

  toggle(): void { this.open() ? this.close() : this.openPalette(); }

  openPalette(): void {
    this.query.set('');
    this.activeIndex.set(0);
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
    this.query.set('');
    this.activeIndex.set(0);
  }

  setQuery(q: string): void {
    this.query.set(q);
    this.activeIndex.set(0);
  }

  // ---- Rows -----------------------------------------------------------

  private readonly commands = computed<PaletteCommand[]>(() => this.buildCommands());

  readonly rows = computed<PaletteRow[]>(() => {
    const q = this.query().trim();

    if (!q) {
      // Default view: recent pages + primary commands.
      return [...this.recentRows(), ...this.commands().filter(c => c.primary).map(c => this.toRow(c))];
    }

    const cmdRows = this.commands()
      .map(c => ({ c, s: scoreEntity(q, c.title, c.keywords ?? '') }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => this.toRow(x.c));

    const entityRows = this.search.instantResultsFor(q)
      .sort((a, b) => b.score - a.score)
      .map(r => this.entityRow(r));

    return [...cmdRows, ...entityRows];
  });

  /** Rows grouped by section, in first-appearance order. */
  readonly groups = computed<PaletteGroup[]>(() => {
    const groups: PaletteGroup[] = [];
    for (const r of this.rows()) {
      let g = groups.find(x => x.label === r.group);
      if (!g) { g = { label: r.group, rows: [] }; groups.push(g); }
      g.rows.push(r);
    }
    return groups;
  });

  readonly hasRows = computed(() => this.rows().length > 0);

  // ---- Keyboard navigation --------------------------------------------

  moveActive(delta: number): void {
    const n = this.rows().length;
    if (!n) return;
    this.activeIndex.set((this.activeIndex() + delta + n) % n);
  }

  isActiveRow(row: PaletteRow): boolean {
    return this.rows()[this.activeIndex()]?.id === row.id;
  }

  runActive(): void {
    const row = this.rows()[this.activeIndex()];
    if (row) void this.runRow(row);
  }

  async runRow(row: PaletteRow): Promise<void> {
    const query = this.query();   // capture before close() clears it
    this.close();
    try { await row.run(query); } catch (e) { console.warn('[Palette] command failed', e); }
  }

  // ---- Command registry -----------------------------------------------

  private buildCommands(): PaletteCommand[] {
    const nav = (route: string): void => { void this.router.navigate([route]); };

    const commands: PaletteCommand[] = [
      // Create
      { id: 'new-task',  group: 'Create', icon: 'plus', title: 'New task', keywords: 'create add task', primary: true,
        run: () => this.router.navigate(['/tasks'], { queryParams: { new: true } }) },
      { id: 'new-note',  group: 'Create', icon: 'plus', title: 'New note', keywords: 'create add note', primary: true,
        run: () => this.createNote() },
      { id: 'new-group', group: 'Create', icon: 'plus', title: 'New group', keywords: 'create add team group', primary: true,
        run: () => this.router.navigate(['/groups'], { queryParams: { new: true } }) },

      // Actions
      { id: 'search',   group: 'Actions', icon: 'search', title: 'Search everything', keywords: 'find search', primary: true,
        run: (q) => this.handoffToSearch(q ?? '') },
      { id: 'ask-ai',   group: 'Actions', icon: 'cpu', title: 'Ask AI', keywords: 'ai assistant chat', primary: true,
        run: () => nav('/ai-chat') },
      { id: 'settings', group: 'Actions', icon: 'settings', title: 'Appearance settings', keywords: 'settings preferences appearance', primary: true,
        run: () => this.theme.appearanceOpen.set(true) },
      { id: 'shortcuts', group: 'Actions', icon: 'grid', title: 'Keyboard shortcuts', keywords: 'help keys shortcuts', primary: false,
        run: () => this.kb.helpOpen.set(true) },

      // Theme
      { id: 'theme-toggle', group: 'Theme', icon: 'moon', title: 'Toggle light / dark theme', keywords: 'theme dark light mode', primary: true,
        run: () => this.theme.toggle() },
      { id: 'theme-light',  group: 'Theme', icon: 'sun',      title: 'Theme: Light',  keywords: 'theme light mode', run: () => this.theme.setTheme('light') },
      { id: 'theme-dark',   group: 'Theme', icon: 'moon',     title: 'Theme: Dark',   keywords: 'theme dark mode',  run: () => this.theme.setTheme('dark') },
      { id: 'theme-system', group: 'Theme', icon: 'settings', title: 'Theme: System', keywords: 'theme system auto', run: () => this.theme.setTheme('system') },
    ];

    // Navigate commands
    for (const n of NAV) {
      commands.push({
        id: `nav-${n.route}`, group: 'Navigate', icon: n.icon, title: `Go to ${n.label}`,
        keywords: `open navigate ${n.label}`, primary: true, run: () => nav(n.route),
      });
    }

    // Accent color commands (surface when searching "accent"/"color").
    for (const p of ACCENT_PRESETS) {
      commands.push({
        id: `accent-${p.color}`, group: 'Theme', icon: 'sun', emoji: '🎨',
        title: `Accent: ${p.name}`, keywords: 'accent color theme', primary: false,
        run: () => this.theme.setAccent(p.color),
      });
    }

    return commands;
  }

  // ---- Helpers --------------------------------------------------------

  private recentRows(): PaletteRow[] {
    const current = this.router.url.split('?')[0];
    return this.recent()
      .filter(route => route !== current)
      .map(route => {
        const n = NAV.find(x => x.route === route)!;
        return { id: `recent-${route}`, group: 'Recent', icon: n.icon, title: n.label, run: () => this.router.navigate([route]) };
      });
  }

  private toRow(c: PaletteCommand): PaletteRow {
    return { id: c.id, title: c.title, subtitle: c.subtitle, icon: c.icon, emoji: c.emoji, group: c.group, run: c.run };
  }

  private entityRow(r: SearchResult): PaletteRow {
    const groupLabel: Record<SearchResult['category'], string> = {
      task: 'Tasks', note: 'Notes', group: 'Groups', category: 'Categories',
      user: 'People', report: 'Daily Reports', calendar: 'Calendar',
    };
    return {
      id: `${r.category}-${r.id}`, title: r.title, subtitle: r.subtitle,
      icon: r.icon, emoji: r.emoji, group: groupLabel[r.category],
      run: () => this.router.navigate(r.route, r.queryParams ? { queryParams: r.queryParams } : {}),
    };
  }

  private async createNote(): Promise<void> {
    const id = await this.notes.createNote(null);
    await this.router.navigate(['/notes', id]);
  }

  private handoffToSearch(q: string): void {
    // Focus the topbar search and run the universal search with the query
    // captured before the palette closed.
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('.topbar__search-input');
      el?.focus();
      if (q) this.search.setQuery(q);
    });
  }
}
