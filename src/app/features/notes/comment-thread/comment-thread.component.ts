import { Component, inject, input, output, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NoteService } from '@core/services/note.service';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { NoteComment } from '@shared/models/note.model';

@Component({
  selector:   'tp-comment-thread',
  standalone: true,
  imports:    [FormsModule, IconComponent],
  templateUrl: './comment-thread.component.html',
  styleUrl:    './comment-thread.component.scss'
})
export class CommentThreadComponent {
  groupId    = input.required<string>();
  noteId     = input.required<string>();
  blockId    = input.required<string>();
  blockPreview = input<string>('');
  isOwner    = input<boolean>(false);

  close = output<void>();

  private readonly notes = inject(NoteService);
  readonly auth = inject(AuthService);

  readonly draft = signal('');

  readonly threadComments = computed<NoteComment[]>(() =>
    this.notes.comments().filter(c => c.blockId === this.blockId())
  );

  canModify = (c: NoteComment): boolean => c.authorId === this.auth.userId() || this.isOwner();

  initial = (name: string): string => (name?.charAt(0) || '?').toUpperCase();

  timeAgo = (c: NoteComment): string => {
    const d = c.createdAt?.toDate?.();
    if (!d) return 'now';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return d.toLocaleDateString();
  };

  async add(): Promise<void> {
    const body = this.draft().trim();
    if (!body) return;
    this.draft.set('');
    await this.notes.addComment(this.groupId(), this.noteId(), this.blockId(), body);
  }

  toggleResolve(c: NoteComment): void {
    this.notes.resolveComment(this.groupId(), this.noteId(), c.id, !c.resolved);
  }

  remove(c: NoteComment): void {
    this.notes.deleteComment(this.groupId(), this.noteId(), c.id);
  }
}
