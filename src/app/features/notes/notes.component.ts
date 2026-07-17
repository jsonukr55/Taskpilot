import { Component, inject, computed, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { NoteService } from '@core/services/note.service';
import { NoteAccessService } from '@core/services/note-access.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { Note, NoteQuickRef } from '@shared/models/note.model';

@Component({
  selector:   'tp-notes',
  standalone: true,
  imports:    [IconComponent],
  templateUrl: './notes.component.html',
  styleUrl:    './notes.component.scss'
})
export class NotesComponent implements OnInit, OnDestroy {
  readonly notes  = inject(NoteService);
  readonly access = inject(NoteAccessService);
  private readonly router = inject(Router);

  ngOnInit(): void { this.notes.openPersonalNotes(); }
  ngOnDestroy(): void { this.notes.closeGroupNotes(); }

  /** Personal notes, pinned first, then by last edit (the service already
   *  streams in updatedAt-desc order). */
  readonly sortedNotes = computed(() => {
    const list   = this.notes.notes();
    const pinned = new Set(this.access.pinned().map(r => r.id));
    if (!pinned.size) return list;
    return [...list].sort((a, b) => {
      const ap = pinned.has(a.id) ? 0 : 1;
      const bp = pinned.has(b.id) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0);
    });
  });

  /** Recently opened, capped for the strip. */
  readonly recentToShow = computed(() => this.access.recent().slice(0, 6));

  preview(n: Note): string {
    const first = n.blocks?.find(b => b.html?.trim());
    if (!first) return 'Empty note';
    const tmp = document.createElement('div');
    tmp.innerHTML = first.html;
    return (tmp.textContent ?? '').slice(0, 90) || 'Empty note';
  }

  /** "Edited 3h ago" label for the card footer. */
  edited(n: Note): string {
    const s = n.updatedAt?.seconds;
    if (!s) return '';
    const min = Math.round((Date.now() - s * 1000) / 60_000);
    if (min < 1)  return 'Edited just now';
    if (min < 60) return `Edited ${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24)  return `Edited ${hr}h ago`;
    const d = Math.round(hr / 24);
    if (d < 7)    return `Edited ${d}d ago`;
    return 'Edited ' + new Date(s * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  async newNote(): Promise<void> {
    const id = await this.notes.createNote(null);
    await this.router.navigate(['/notes', id]);
  }
  open(id: string): void {
    this.router.navigate(['/notes', id]);
  }
  /** Navigate to a quick-access ref (personal or group note). */
  openRef(r: NoteQuickRef): void {
    this.router.navigate(r.groupId ? ['/groups', r.groupId, 'notes', r.id] : ['/notes', r.id]);
  }
  toggleFav(ev: Event, n: Note): void {
    ev.stopPropagation();
    this.access.toggleFavorite(n);
  }
  togglePin(ev: Event, n: Note): void {
    ev.stopPropagation();
    this.access.togglePin(n);
  }
  async remove(ev: Event, id: string): Promise<void> {
    ev.stopPropagation();
    if (!confirm('Delete this note?')) return;
    await this.notes.deleteNote(null, id);
  }
}
