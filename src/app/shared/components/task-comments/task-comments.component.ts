import { Component, inject, input, computed, signal, effect, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { TaskCommentService } from '@core/services/task-comment.service';
import { TaskActivityService } from '@core/services/task-activity.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { DialogService } from '@core/services/dialog.service';
import { IconComponent } from '../icon/icon.component';
import { TaskComment, threadComments } from '@shared/models/task-comment.model';
import { TaskActivity } from '@shared/models/task-activity.model';

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
  private readonly act   = inject(TaskActivityService);
  readonly auth          = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly tab = signal<'comments' | 'activity'>('comments');

  readonly threads = computed(() => threadComments(this.svc.comments()));
  readonly count   = computed(() => this.svc.comments().length);
  readonly activity = computed(() => this.act.activity());
  readonly activityCount = computed(() => this.act.activity().length);

  readonly draft     = signal('');
  readonly replyTo   = signal<string | null>(null);   // parent comment id
  readonly replyText = signal('');
  readonly editId    = signal<string | null>(null);
  readonly editText  = signal('');

  // Images being attached to the post being composed (local previews).
  readonly draftImages = signal<{ file: File; url: string }[]>([]);
  readonly posting     = signal(false);

  // Resolved signed URLs for images already posted (path -> url).
  private readonly urlCache = signal<Record<string, string>>({});
  imgUrl = (path: string): string => this.urlCache()[path] ?? '';

  // Full-size preview
  readonly lightbox = signal<string | null>(null);

  constructor() {
    effect(() => { const id = this.taskId(); this.svc.open(id); this.act.open(id); });
    // Resolve signed URLs for any newly-seen comment images (deferred out of
    // the reactive context so the signal writes don't need allowSignalWrites).
    effect(() => {
      const paths = [...new Set(this.svc.comments().flatMap(c => c.images))];
      queueMicrotask(() => void this.ensureUrls(paths));
    });
  }
  ngOnDestroy(): void { this.svc.close(); this.act.close(); this.clearDraftImages(); }

  private async ensureUrls(paths: string[]): Promise<void> {
    const cache = this.urlCache();
    const missing = paths.filter(p => p && !cache[p]);
    if (!missing.length) return;
    const entries = await Promise.all(missing.map(async p => {
      try { return [p, await this.svc.signedUrl(p)] as const; }
      catch { return [p, ''] as const; }
    }));
    this.urlCache.update(c => {
      const next = { ...c };
      for (const [p, u] of entries) if (u) next[p] = u;
      return next;
    });
  }

  activityTime = (a: TaskActivity): string => {
    const d = a.createdAt?.toDate?.();
    if (!d) return '';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return d.toLocaleDateString();
  };

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

  // ---- Compose images ----
  pickImages(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';   // allow re-picking the same file
    for (const f of files) {
      if (!f.type.startsWith('image/')) { this.toast.error(`"${f.name}" isn't an image.`); continue; }
      if (f.size > 10 * 1024 * 1024)    { this.toast.error(`"${f.name}" is over the 10 MB limit.`); continue; }
      this.draftImages.update(list => [...list, { file: f, url: URL.createObjectURL(f) }]);
    }
  }

  removeDraftImage(i: number): void {
    this.draftImages.update(list => {
      const item = list[i];
      if (item) URL.revokeObjectURL(item.url);
      return list.filter((_, idx) => idx !== i);
    });
  }

  private clearDraftImages(): void {
    for (const it of this.draftImages()) URL.revokeObjectURL(it.url);
    this.draftImages.set([]);
  }

  openLightbox(path: string): void { const u = this.imgUrl(path); if (u) this.lightbox.set(u); }
  closeLightbox(): void { this.lightbox.set(null); }

  async post(): Promise<void> {
    const body = this.draft().trim();
    const imgs = this.draftImages();
    if (!body && !imgs.length) return;
    this.posting.set(true);
    try {
      const paths: string[] = [];
      for (const it of imgs) paths.push(await this.svc.uploadImage(this.taskId(), it.file));
      await this.svc.add(this.taskId(), body, null, paths);
      this.draft.set('');
      this.clearDraftImages();
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not post the comment');
    } finally {
      this.posting.set(false);
    }
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
    if (!(await this.dialog.confirm({ title: 'Delete comment', message: 'Delete this comment?', confirmText: 'Delete', danger: true }))) return;
    try { await this.svc.remove(c.id, c.images); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not delete the comment'); }
  }
}
