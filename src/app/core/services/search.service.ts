import { Injectable, inject, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { TaskService } from './task.service';
import { GroupService } from './group.service';
import { CategoryService } from './category.service';
import { Note } from '@shared/models/note.model';
import { Group } from '@shared/models/group.model';
import {
  SearchResult, SearchSection, SearchCategory, fuzzyScore, scoreEntity,
} from '@shared/models/search.model';

// Kept for backward-compat with any external importer.
export interface NoteHit { note: Note; source: string; link: string[]; }

const NOTE_DEBOUNCE_MS = 500;
const PER_CATEGORY = 5;
const NOTE_SCAN_LIMIT = 80;   // bound each collection read (avoid unbounded getDocs)

// Section order + metadata (also defines the flat keyboard-nav order).
const SECTION_META: { category: SearchCategory; label: string; icon: string }[] = [
  { category: 'task',     label: 'Tasks',         icon: 'check-square' },
  { category: 'note',     label: 'Notes',         icon: 'file-text' },
  { category: 'group',    label: 'Groups',        icon: 'users' },
  { category: 'category', label: 'Categories',    icon: 'layers' },
  { category: 'user',     label: 'People',        icon: 'user' },
  { category: 'report',   label: 'Daily Reports', icon: 'check-square' },
  { category: 'calendar', label: 'Calendar',      icon: 'calendar' },
];

// ============================================================
// SearchService — universal, fuzzy, categorized search.
//   • Instant: tasks, groups, categories, people, reports, calendar
//     (all from in-memory signals).
//   • Debounced: notes (Firestore getDocs across personal + group notes).
//   • Keyboard navigation via activeIndex over the flattened results.
// ============================================================
@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly supa       = inject(SupabaseService);
  private readonly auth       = inject(AuthService);
  private readonly tasks      = inject(TaskService);
  private readonly groups     = inject(GroupService);
  private readonly categories = inject(CategoryService);

  readonly queryText = signal('');
  readonly open      = signal(false);
  readonly loading   = signal(false);
  readonly activeIndex = signal(0);

  /** Async note results (fetched, debounced). */
  private readonly noteResults = signal<SearchResult[]>([]);

  // ---- Instant, in-memory results -------------------------------------

  private readonly instantResults = computed<SearchResult[]>(() => this.instantResultsFor(this.queryText()));

  /** Compute instant (in-memory) results for an arbitrary query. Pure — does
   *  NOT touch the dropdown state, so the command palette can reuse it. */
  instantResultsFor(rawQuery: string): SearchResult[] {
    const q = rawQuery.trim();
    if (!q) return [];
    const out: SearchResult[] = [];

    // Tasks
    for (const t of this.tasks.tasks()) {
      const score = scoreEntity(q, t.title, `${t.description ?? ''} ${t.tags.join(' ')}`);
      if (score > 0) out.push({
        id: t.id, category: 'task', title: t.title,
        subtitle: this.statusLabel(t.status), icon: 'check-square',
        route: ['/tasks', t.id], score,
      });
    }

    // Groups
    for (const g of this.groups.groups()) {
      const score = scoreEntity(q, g.name, g.description ?? '');
      if (score > 0) out.push({
        id: g.id, category: 'group', title: g.name, emoji: g.icon,
        subtitle: `${g.memberIds.length} member${g.memberIds.length === 1 ? '' : 's'}`,
        icon: 'users', route: ['/groups', g.id], score,
      });
    }

    // Categories → jump to filtered task list
    for (const c of this.categories.rootCategories()) {
      const score = scoreEntity(q, c.name, (c.keywords ?? []).join(' '));
      if (score > 0) out.push({
        id: c.id, category: 'category', title: c.name, emoji: c.icon,
        subtitle: 'Category', icon: 'layers',
        route: ['/tasks'], queryParams: { category: c.id }, score,
      });
    }

    // People (self + members of shared groups). Build a uid→group index once
    // instead of a .find() per person (was O(people × groups)).
    const groupByMember = new Map<string, Group>();
    for (const gr of this.groups.groups()) {
      for (const uid of gr.memberIds) if (!groupByMember.has(uid)) groupByMember.set(uid, gr);
    }
    for (const p of this.groups.assignablePeople()) {
      const score = fuzzyScore(q, p.displayName);
      if (score > 0) {
        const g = groupByMember.get(p.uid);
        out.push({
          id: p.uid, category: 'user',
          title: p.isSelf ? `${p.displayName} (you)` : p.displayName,
          subtitle: g ? g.name : 'Person', icon: 'user',
          route: g ? ['/groups', g.id] : ['/groups'], score,
        });
      }
    }

    // Daily reports — matched by team name / report keywords
    for (const g of this.groups.groups()) {
      const score = scoreEntity(q, `${g.name} daily report standup`, '');
      if (score > 0) out.push({
        id: `report_${g.id}`, category: 'report', title: `Daily report · ${g.name}`,
        subtitle: 'Open daily report', icon: 'check-square', route: ['/daily'], score,
      });
    }

    // Calendar — navigational
    const calScore = fuzzyScore(q, 'calendar schedule agenda events');
    if (calScore > 0) out.push({
      id: 'calendar', category: 'calendar', title: 'Calendar',
      subtitle: 'Open the calendar', icon: 'calendar', route: ['/calendar'], score: calScore,
    });

    return out;
  }

  // ---- Sections + flat list -------------------------------------------

  readonly sections = computed<SearchSection[]>(() => {
    const all = [...this.instantResults(), ...this.noteResults()];
    return SECTION_META
      .map(meta => ({
        ...meta,
        results: all
          .filter(r => r.category === meta.category)
          .sort((a, b) => b.score - a.score)
          .slice(0, PER_CATEGORY),
      }))
      .filter(s => s.results.length > 0);
  });

  /** Flattened results in section order — drives keyboard navigation. */
  readonly flatResults = computed<SearchResult[]>(() =>
    this.sections().flatMap(s => s.results)
  );

  readonly hasResults = computed(() => this.flatResults().length > 0);

  // ---- Query lifecycle ------------------------------------------------

  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  setQuery(q: string): void {
    this.queryText.set(q);
    this.activeIndex.set(0);
    clearTimeout(this.timer);

    const trimmed = q.trim();
    if (!trimmed) { this.close(); return; }

    this.open.set(true);
    this.loading.set(true);
    this.timer = setTimeout(() => void this.fetchNotes(trimmed), NOTE_DEBOUNCE_MS);
  }

  close(): void {
    clearTimeout(this.timer);
    this.open.set(false);
    this.loading.set(false);
    this.noteResults.set([]);
    this.queryText.set('');
    this.activeIndex.set(0);
  }

  // ---- Keyboard navigation --------------------------------------------

  moveActive(delta: number): void {
    const n = this.flatResults().length;
    if (!n) return;
    this.activeIndex.set((this.activeIndex() + delta + n) % n);
  }

  activeResult(): SearchResult | null {
    return this.flatResults()[this.activeIndex()] ?? null;
  }

  isActive(result: SearchResult): boolean {
    return this.activeResult()?.id === result.id && this.activeResult()?.category === result.category;
  }

  // ---- Notes (async) --------------------------------------------------

  private async fetchNotes(q: string): Promise<void> {
    const mySeq = ++this.seq;
    const results: SearchResult[] = [];
    const uid = this.auth.userId();
    try {
      if (uid) {
        // Personal notes (owner_id == uid), bounded.
        const { data: personal } = await this.supa.db('notes')
          .select('*').eq('owner_id', uid).limit(NOTE_SCAN_LIMIT);
        (personal ?? []).forEach(d => this.pushNote(results, q, rowToNote(d), 'My notes', ['/notes', d.id]));

        // Group notes: most-recent-first, bounded.
        for (const g of this.groups.groups()) {
          const { data: snap } = await this.supa.db('notes')
            .select('*').eq('group_id', g.id).order('updated_at', { ascending: false }).limit(NOTE_SCAN_LIMIT);
          (snap ?? []).forEach(d => this.pushNote(results, q, rowToNote(d), g.name, ['/groups', g.id, 'notes', d.id]));
        }
      }
    } catch (e) {
      console.warn('[Search] note search failed', e);
    }

    if (mySeq !== this.seq) return;   // superseded by a newer query
    this.noteResults.set(results);
    this.loading.set(false);
  }

  private pushNote(out: SearchResult[], q: string, n: Note, source: string, route: string[]): void {
    const score = scoreEntity(q, n.title || 'Untitled', this.noteBody(n));
    if (score > 0) out.push({
      id: n.id, category: 'note', title: n.title || 'Untitled',
      subtitle: source, emoji: n.icon || '📄', icon: 'file-text', route, score,
    });
  }

  private noteBody(n: Note): string {
    return (n.blocks ?? []).map(b => b.html).join(' ').replace(/<[^>]+>/g, ' ');
  }

  /** Short plain-text preview of a note (used by the results list). */
  preview(n: Note): string {
    const first = (n.blocks ?? []).find(b => b.html?.trim());
    if (!first) return 'Empty note';
    const tmp = document.createElement('div');
    tmp.innerHTML = first.html;
    return (tmp.textContent ?? '').slice(0, 80) || 'Empty note';
  }

  private statusLabel(status: string): string {
    return status === 'in_progress' ? 'In progress'
         : status === 'completed'   ? 'Done'
         : status === 'cancelled'   ? 'Cancelled' : 'Open';
  }
}

/** Minimal row → Note mapping for search (only fields the results list needs). */
function rowToNote(r: any): Note {
  return {
    id:        r.id,
    groupId:   r.group_id ?? null,
    ownerId:   r.owner_id ?? undefined,
    title:     r.title,
    icon:      r.icon ?? undefined,
    blocks:    r.blocks ?? [],
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as Note;
}
