import { Component, inject, input, computed, signal, effect, OnDestroy } from '@angular/core';
import { AttachmentService } from '@core/services/attachment.service';
import { ToastService } from '@core/services/toast.service';
import { DialogService } from '@core/services/dialog.service';
import { IconComponent } from '../icon/icon.component';
import { TaskAttachment, isImage, formatBytes } from '@shared/models/task-attachment.model';

@Component({
  selector:   'tp-task-attachments',
  standalone: true,
  imports:    [IconComponent],
  templateUrl: './task-attachments.component.html',
  styleUrl:    './task-attachments.component.scss'
})
export class TaskAttachmentsComponent implements OnDestroy {
  // Not input.required: the constructor effect below reads this eagerly; a
  // required input read before binding throws (NG0950) and kills the effect,
  // so the load never fires. Default '' + guard is reliable.
  taskId  = input<string>('');
  canEdit = input<boolean>(true);

  private readonly svc    = inject(AttachmentService);
  private readonly toast  = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly files = computed(() => this.svc.attachments());
  readonly total = computed(() => this.files().reduce((s, a) => s + a.size, 0));
  readonly uploading = signal(false);
  readonly preview = signal<{ att: TaskAttachment; url: string } | null>(null);

  isImage = isImage;
  fmt = formatBytes;

  constructor() {
    effect(() => { const id = this.taskId(); if (id) this.svc.open(id); });
  }
  ngOnDestroy(): void { this.svc.close(); }

  async onFiles(input: HTMLInputElement): Promise<void> {
    const list = Array.from(input.files ?? []);
    input.value = '';
    if (!list.length) return;
    this.uploading.set(true);
    try {
      for (const f of list) {
        try { await this.svc.upload(this.taskId(), f); }
        catch (e: any) { this.toast.error(e?.message ?? `Could not upload ${f.name}`); }
      }
    } finally {
      this.uploading.set(false);
    }
  }

  async openPreview(att: TaskAttachment): Promise<void> {
    try {
      const url = await this.svc.signedUrl(att);
      // Images/video preview inline in a small dialog; everything else (pdf,
      // zip, docs) opens in a new tab to avoid iframe sanitization.
      const previewable = this.isImage(att) || (att.mime ?? '').startsWith('video/');
      if (previewable) this.preview.set({ att, url });
      else window.open(url, '_blank', 'noopener');
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not open the file');
    }
  }

  async download(att: TaskAttachment): Promise<void> {
    try { window.open(await this.svc.signedUrl(att), '_blank', 'noopener'); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not open the file'); }
  }

  async remove(att: TaskAttachment): Promise<void> {
    if (!(await this.dialog.confirm({ title: 'Delete file', message: `Delete "${att.name}"?`, confirmText: 'Delete', danger: true }))) return;
    try { await this.svc.remove(att); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not delete the file'); }
  }

  isVideo = (a: TaskAttachment): boolean => (a.mime ?? '').startsWith('video/');
  isPdf   = (a: TaskAttachment): boolean => a.mime === 'application/pdf';
}
