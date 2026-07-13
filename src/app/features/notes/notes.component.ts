import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { NoteService } from '@core/services/note.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { Note } from '@shared/models/note.model';

@Component({
  selector:   'tp-notes',
  standalone: true,
  imports:    [IconComponent],
  templateUrl: './notes.component.html',
  styleUrl:    './notes.component.scss'
})
export class NotesComponent implements OnInit, OnDestroy {
  readonly notes = inject(NoteService);
  private readonly router = inject(Router);

  ngOnInit(): void { this.notes.openPersonalNotes(); }
  ngOnDestroy(): void { this.notes.closeGroupNotes(); }

  preview(n: Note): string {
    const first = n.blocks?.find(b => b.html?.trim());
    if (!first) return 'Empty note';
    const tmp = document.createElement('div');
    tmp.innerHTML = first.html;
    return (tmp.textContent ?? '').slice(0, 90) || 'Empty note';
  }

  async newNote(): Promise<void> {
    const id = await this.notes.createNote(null);
    await this.router.navigate(['/notes', id]);
  }
  open(id: string): void {
    this.router.navigate(['/notes', id]);
  }
  async remove(ev: Event, id: string): Promise<void> {
    ev.stopPropagation();
    if (!confirm('Delete this note?')) return;
    await this.notes.deleteNote(null, id);
  }
}
