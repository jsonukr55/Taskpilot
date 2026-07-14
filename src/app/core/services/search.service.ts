import { Injectable, inject, signal, computed } from '@angular/core';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { TaskService } from './task.service';
import { GroupService } from './group.service';
import { Task } from '@shared/models/task.model';
import { Note } from '@shared/models/note.model';

export interface NoteHit { note: Note; source: string; link: (string)[]; }
export interface NoteSection { source: string; notes: NoteHit[]; }

const DEBOUNCE_MS = 2000;

// ============================================================
// SearchService — global search across tasks + personal & group notes.
// Tasks resolve instantly from memory; notes are fetched after a 2s debounce.
// ============================================================
@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly firestore = inject(Firestore);
  private readonly auth      = inject(AuthService);
  private readonly tasks     = inject(TaskService);
  private readonly groups    = inject(GroupService);

  readonly queryText = signal('');
  readonly open      = signal(false);
  readonly loading   = signal(false);
  readonly taskHits  = signal<Task[]>([]);
  readonly noteHits  = signal<NoteHit[]>([]);

  readonly noteSections = computed<NoteSection[]>(() => {
    const map = new Map<string, NoteHit[]>();
    for (const h of this.noteHits()) {
      (map.get(h.source) ?? map.set(h.source, []).get(h.source)!).push(h);
    }
    return [...map.entries()].map(([source, notes]) => ({ source, notes }));
  });

  readonly hasResults = computed(() => this.taskHits().length > 0 || this.noteHits().length > 0);

  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  setQuery(q: string): void {
    this.queryText.set(q);
    clearTimeout(this.timer);
    const trimmed = q.trim();
    if (!trimmed) { this.close(); return; }
    this.open.set(true);
    this.loading.set(true);
    this.taskHits.set(this.matchTasks(trimmed.toLowerCase()));   // instant
    this.timer = setTimeout(() => void this.run(trimmed.toLowerCase()), DEBOUNCE_MS);
  }

  close(): void {
    clearTimeout(this.timer);
    this.open.set(false);
    this.loading.set(false);
    this.taskHits.set([]);
    this.noteHits.set([]);
    this.queryText.set('');
  }

  private matchTasks(q: string): Task[] {
    return this.tasks.tasks()
      .filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q)))
      .slice(0, 25);
  }

  private noteText(n: Note): string {
    return (n.title + ' ' + (n.blocks ?? []).map(b => b.html).join(' ')).toLowerCase();
  }

  private async run(q: string): Promise<void> {
    const mySeq = ++this.seq;
    this.taskHits.set(this.matchTasks(q));

    const hits: NoteHit[] = [];
    const uid = this.auth.userId();
    try {
      if (uid) {
        const personal = await getDocs(query(collection(this.firestore, 'notes'), where('ownerId', '==', uid)));
        personal.docs.forEach(d => {
          const n = { id: d.id, ...d.data() } as Note;
          if (this.noteText(n).includes(q)) hits.push({ note: n, source: 'My notes', link: ['/notes', n.id] });
        });

        for (const g of this.groups.groups()) {
          const snap = await getDocs(collection(this.firestore, 'groups', g.id, 'notes'));
          snap.docs.forEach(d => {
            const n = { id: d.id, ...d.data() } as Note;
            if (this.noteText(n).includes(q)) hits.push({ note: n, source: g.name, link: ['/groups', g.id, 'notes', n.id] });
          });
        }
      }
    } catch (e) {
      console.warn('[Search] note search failed', e);
    }

    if (mySeq !== this.seq) return;  // a newer search superseded this one
    this.noteHits.set(hits);
    this.loading.set(false);
  }

  /** Short plain-text preview of a note for the results list. */
  preview(n: Note): string {
    const first = (n.blocks ?? []).find(b => b.html?.trim());
    if (!first) return 'Empty note';
    const tmp = document.createElement('div');
    tmp.innerHTML = first.html;
    return (tmp.textContent ?? '').slice(0, 80) || 'Empty note';
  }
}
