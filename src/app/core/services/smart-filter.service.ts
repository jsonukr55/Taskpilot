import { Injectable, inject, computed, signal, effect, Signal } from '@angular/core';
import { TaskService, TaskFilter, TaskSortOption } from './task.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { FilterPreset } from '@shared/models/filter-preset.model';
import { nanoid } from '@shared/utils/id.util';

// ============================================================
// SmartFilterService
// ------------------------------------------------------------
// Reusable filter presets on top of the single TaskService filter
// pipeline (TaskService.filter / sort / searchQuery → filteredTasks).
//
//  • Quick filters  — built-in one-click presets (My Tasks, Due Today,
//    Overdue, High Priority, Recently Updated, Completed This Week).
//  • Saved filters  — user snapshots of the current view, persisted to
//    localStorage per-user (no Firestore schema change).
//  • Recent filters — auto-recorded whenever the active filter changes,
//    so the last few views are one click away.
//
// All state derives from / drives the existing TaskService signals —
// there is no parallel filtering engine and no duplicated logic.
// ============================================================

const RECENT_LIMIT = 6;
const RECORD_DEBOUNCE_MS = 1200;

@Injectable({ providedIn: 'root' })
export class SmartFilterService {
  private readonly tasks      = inject(TaskService);
  private readonly auth       = inject(AuthService);
  private readonly categories = inject(CategoryService);

  readonly saved  = signal<FilterPreset[]>([]);
  readonly recent = signal<FilterPreset[]>([]);

  // ---- Built-in quick filters -----------------------------------------

  /** One-click presets. `My Tasks` binds to the current user at build time. */
  readonly quickFilters: Signal<FilterPreset[]> = computed(() => {
    const uid = this.auth.userId();
    const presets: FilterPreset[] = [
      { id: 'due-today',    label: 'Due Today',     icon: 'clock',        kind: 'quick', filter: { dueToday: true } },
      { id: 'overdue',      label: 'Overdue',       icon: 'alert-circle', kind: 'quick', filter: { isOverdue: true } },
      { id: 'high-priority',label: 'High Priority', icon: 'flag',         kind: 'quick', filter: { priority: ['high', 'urgent'] } },
      { id: 'recent',       label: 'Recently Updated', icon: 'repeat',    kind: 'quick', filter: { updatedWithinDays: 2 }, sort: { field: 'updatedAt', direction: 'desc' } },
      { id: 'done-week',    label: 'Completed This Week', icon: 'check-circle', kind: 'quick', filter: { status: ['completed'], completedWithinDays: 7 }, sort: { field: 'updatedAt', direction: 'desc' } },
    ];
    if (uid) {
      presets.unshift({ id: 'mine', label: 'My Tasks', icon: 'user', kind: 'quick', filter: { assigneeId: uid } });
    }
    return presets;
  });

  // ---- Active-state matching ------------------------------------------

  /** Signature of the view that's currently applied. */
  private readonly activeSignature = computed(() =>
    this.signature(this.tasks.filter(), this.tasks.sort(), this.tasks.searchQuery())
  );

  /** True when the active view exactly matches the given preset. */
  isActive(preset: FilterPreset): boolean {
    return this.signature(preset.filter, preset.sort, preset.search) === this.activeSignature();
  }

  /** Whether any filter/search is currently applied. */
  readonly hasActiveFilter = computed(() => {
    const f = this.tasks.filter();
    return Object.keys(f).length > 0 || this.tasks.searchQuery().trim().length > 0;
  });

  constructor() {
    // Reload persisted presets whenever the signed-in user changes.
    effect(() => { this.loadForUser(this.auth.userId()); }, { allowSignalWrites: true });

    // Auto-record the active view into "recent" (debounced).
    effect(() => {
      const sig = this.activeSignature();
      const filter = this.tasks.filter();
      const empty = Object.keys(filter).length === 0 && this.tasks.searchQuery().trim() === '';
      this.scheduleRecord(sig, empty);
    });
  }

  // ---- Apply / clear --------------------------------------------------

  /** Apply a preset to the live task view. */
  apply(preset: FilterPreset): void {
    this.tasks.filter.set({ ...preset.filter });
    this.tasks.sort.set(preset.sort ?? { field: 'dueDate', direction: 'asc' });
    this.tasks.searchQuery.set(preset.search ?? '');
  }

  clear(): void {
    this.tasks.filter.set({});
    this.tasks.searchQuery.set('');
  }

  // ---- Saved filters --------------------------------------------------

  /** Snapshot the current view as a named saved filter. */
  saveCurrent(label: string): void {
    const name = label.trim();
    if (!name) return;
    const preset: FilterPreset = {
      id: nanoid(10), label: name, icon: 'filter', kind: 'saved',
      filter: { ...this.tasks.filter() },
      sort:   { ...this.tasks.sort() },
      search: this.tasks.searchQuery(),
    };
    this.saved.update(list => [...list, preset]);
    this.persist('saved', this.saved());
  }

  removeSaved(id: string): void {
    this.saved.update(list => list.filter(p => p.id !== id));
    this.persist('saved', this.saved());
  }

  clearRecent(): void {
    this.recent.set([]);
    this.persist('recent', []);
  }

  // ---- Recent recording -----------------------------------------------

  private recordTimer?: ReturnType<typeof setTimeout>;

  private scheduleRecord(signature: string, empty: boolean): void {
    clearTimeout(this.recordTimer);
    if (empty) return;
    // Snapshot now (before the debounce) so we record what triggered it.
    const filter = { ...this.tasks.filter() };
    const sort   = { ...this.tasks.sort() };
    const search = this.tasks.searchQuery();
    this.recordTimer = setTimeout(() => this.record(signature, filter, sort, search), RECORD_DEBOUNCE_MS);
  }

  private record(signature: string, filter: TaskFilter, sort: TaskSortOption, search: string): void {
    // Don't clutter "recent" with views already surfaced as quick/saved chips.
    const known = [...this.quickFilters(), ...this.saved()]
      .some(p => this.signature(p.filter, p.sort, p.search) === signature);
    if (known) return;
    if (this.recent().some(p => this.signature(p.filter, p.sort, p.search) === signature)) return;

    const preset: FilterPreset = {
      id: nanoid(10), label: this.describe(filter, search), icon: 'clock', kind: 'recent',
      filter, sort, search,
    };
    this.recent.update(list => [preset, ...list].slice(0, RECENT_LIMIT));
    this.persist('recent', this.recent());
  }

  // ---- Persistence (localStorage, per-user) ---------------------------

  private key(kind: 'saved' | 'recent', uid: string): string {
    return `taskpilot:filters:${kind}:${uid}`;
  }

  private loadForUser(uid: string | null): void {
    if (!uid || typeof localStorage === 'undefined') {
      this.saved.set([]); this.recent.set([]);
      return;
    }
    this.saved.set(this.read(this.key('saved', uid)));
    this.recent.set(this.read(this.key('recent', uid)));
  }

  private read(key: string): FilterPreset[] {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) as FilterPreset[] : [];
    } catch {
      return [];
    }
  }

  private persist(kind: 'saved' | 'recent', list: FilterPreset[]): void {
    const uid = this.auth.userId();
    if (!uid || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.key(kind, uid), JSON.stringify(list));
    } catch { /* quota / private mode — non-fatal */ }
  }

  // ---- Helpers --------------------------------------------------------

  /** Stable signature of a view for equality checks (order-independent). */
  private signature(filter: TaskFilter, sort?: TaskSortOption, search?: string): string {
    const norm: Record<string, unknown> = {};
    Object.keys(filter).sort().forEach(k => {
      const v = (filter as Record<string, unknown>)[k];
      norm[k] = Array.isArray(v) ? [...v].sort() : v;
    });
    return JSON.stringify({ f: norm, s: sort ?? null, q: (search ?? '').trim() });
  }

  /** Human label auto-generated from a filter (for recent chips). */
  private describe(filter: TaskFilter, search: string): string {
    const parts: string[] = [];
    if (search.trim())            parts.push(`“${search.trim()}”`);
    if (filter.isOverdue)         parts.push('Overdue');
    if (filter.dueToday)          parts.push('Due today');
    if (filter.completedWithinDays != null) parts.push('Completed');
    if (filter.updatedWithinDays != null)   parts.push('Recently updated');
    if (filter.priority?.length)  parts.push(filter.priority.map(cap).join('/'));
    if (filter.status?.length)    parts.push(filter.status.map(statusLabel).join('/'));
    if (filter.categoryIds?.length) {
      parts.push(filter.categoryIds.map(id => this.categories.getCategoryById(id)?.name ?? 'Category').join('/'));
    }
    if (filter.assigneeId)        parts.push(filter.assigneeId === this.auth.userId() ? 'Mine' : 'Assigned');
    return parts.join(' · ') || 'All tasks';
  }
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function statusLabel(s: string): string {
  return s === 'in_progress' ? 'In progress' : s === 'todo' ? 'To do' : cap(s);
}
