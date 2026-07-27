import { Component, inject, input, computed, signal, effect, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { TaskCommentService } from '@core/services/task-comment.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { IconComponent } from '../icon/icon.component';
import { TaskComment, threadComments } from '@shared/models/task-comment.model';

@Component({
  selector:   'tp-task-comments',
  standalone: true,
  imports:    [FormsModule, NgTemplateOutlet, IconComponent],
  templateUrl: './task-comments.component.html',
  styleUrl:    './task-comments.component.scss'
})
export class TaskCommentsComponent implements OnDestroy {
  taskId     = input.required<string>();
  canComment = input<boolean>(true);

  private readonly svc   = inject(TaskCommentService);
  readonly auth          = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly threads = computed(() => threadComments(this.svc.comments()));
  readonly count   = computed(() => this.svc.comments().length);

  readonly draft     = signal('');
  readonly replyTo   = signal<string | null>(null);   // parent comment id
  readonly replyText = signal('');
  readonly editId    = signal<string | null>(null);
  readonly editText  = signal('');

  constructor() {
    effect(() => this.svc.open(this.taskId()));
  }
  ngOnDestroy(): void { this.svc.close(); }

  canModify = (c: TaskComment): boolean => c.authorId === this.auth.userId();
  initial   = (name: string): string => (name?.charAt(0) || '?').toUpperCase();

  timeAgo = (c: TaskComment): string => {
    const d = c.createdAt?.toDate?.();
    if (!d) return 'now';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return d.toLocaleDateString();
  };

  async post(): Promise<void> {
    const body = this.draft().trim();
    if (!body) return;
    this.draft.set('');
    try { await this.svc.add(this.taskId(), body); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not post the comment'); }
  }

  openReply(parentId: string): void {
    this.replyTo.set(parentId);
    this.replyText.set('');
  }
  cancelReply(): void { this.replyTo.set(null); this.replyText.set(''); }

  async sendReply(parentId: string): Promise<void> {
    const body = this.replyText().trim();
    if (!body) return;
    this.cancelReply();
    try { await this.svc.add(this.taskId(), body, parentId); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not post the reply'); }
  }

  startEdit(c: TaskComment): void { this.editId.set(c.id); this.editText.set(c.body); }
  cancelEdit(): void { this.editId.set(null); this.editText.set(''); }

  async saveEdit(c: TaskComment): Promise<void> {
    const body = this.editText().trim();
    if (!body || body === c.body) { this.cancelEdit(); return; }
    this.cancelEdit();
    try { await this.svc.edit(c.id, body); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not update the comment'); }
  }

  async remove(c: TaskComment): Promise<void> {
    if (!confirm('Delete this comment?')) return;
    try { await this.svc.remove(c.id); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not delete the comment'); }
  }
}
