import { Component, output, inject, signal, computed } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { AiService } from '@core/services/ai.service';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { AiExtractedTask, TaskPriority } from '@shared/models/task.model';
import { Timestamp } from '@angular/fire/firestore';

type InputMode = 'text' | 'ai' | 'image' | 'file' | 'form';

@Component({
  selector:   'tp-create-task-modal',
  standalone: true,
  imports:    [FormsModule, ReactiveFormsModule, IconComponent, DatePipe, DecimalPipe],
  templateUrl: './create-task-modal.component.html',
  styleUrl:    './create-task-modal.component.scss'
})
export class CreateTaskModalComponent {
  close = output<void>();

  private readonly taskService  = inject(TaskService);
  private readonly categories   = inject(CategoryService);
  private readonly ai           = inject(AiService);
  private readonly auth         = inject(AuthService);
  private readonly fb           = inject(FormBuilder);

  readonly mode          = signal<InputMode>('ai');
  readonly isProcessing  = signal(false);
  readonly aiText        = signal('');
  readonly extracted     = signal<AiExtractedTask[]>([]);
  readonly error         = signal<string | null>(null);
  readonly imagePreview  = signal<string | null>(null);
  readonly imageBase64   = signal<string | null>(null);
  readonly imageMime     = signal<string>('image/jpeg');
  readonly fileName      = signal<string | null>(null);

  readonly categories$ = computed(() => this.categories.rootCategories());

  // ---- Subtask drafts (manual mode) ----
  readonly subtaskDrafts   = signal<string[]>([]);
  readonly newSubtaskDraft = signal('');

  addSubtaskDraft(): void {
    const t = this.newSubtaskDraft().trim();
    if (!t) return;
    this.subtaskDrafts.update(list => [...list, t]);
    this.newSubtaskDraft.set('');
  }
  removeSubtaskDraft(i: number): void {
    this.subtaskDrafts.update(list => list.filter((_, idx) => idx !== i));
  }

  // ---- Form (manual mode) ----
  readonly form = this.fb.group({
    title:          ['', [Validators.required, Validators.minLength(2)]],
    description:    [''],
    priority:       ['medium' as TaskPriority],
    startDate:      [''],
    dueDate:        [''],
    dueTime:        [''],
    estimatedHours: [null as number | null],
    categoryId:     [''],
    tags:           ['']
  });

  // ---- AI Text Extraction ----
  async extractFromText(): Promise<void> {
    const text = this.aiText().trim();
    if (!text) return;

    this.isProcessing.set(true);
    this.error.set(null);

    try {
      const tasks = await this.ai.extractTasksFromText(
        text,
        this.categories.categories(),
        this.auth.userProfile()?.preferences.timezone ?? 'UTC'
      );
      this.extracted.set(tasks);
    } catch (e) {
      this.error.set('Failed to extract tasks. Try again or use manual entry.');
    } finally {
      this.isProcessing.set(false);
    }
  }

  // ---- Image Upload ----
  onImageSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      // data:image/jpeg;base64,<data>
      const [header, data] = result.split(',');
      this.imageBase64.set(data);
      this.imageMime.set(header.split(':')[1].split(';')[0]);
      this.imagePreview.set(result);
    };
    reader.readAsDataURL(file);
  }

  async extractFromImage(): Promise<void> {
    const base64 = this.imageBase64();
    if (!base64) return;

    this.isProcessing.set(true);
    this.error.set(null);

    try {
      const tasks = await this.ai.extractTasksFromImage(
        base64,
        this.imageMime(),
        this.categories.categories()
      );
      this.extracted.set(tasks);
    } catch (e) {
      this.error.set('Failed to process image. Try a clearer photo.');
    } finally {
      this.isProcessing.set(false);
    }
  }

  // ---- File Import (JSON / CSV / Excel) ----
  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.fileName.set(file.name);
    this.error.set(null);

    const ext = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        let tasks: AiExtractedTask[] = [];

        if (ext === 'json') {
          const parsed = JSON.parse(text);
          const items = Array.isArray(parsed) ? parsed : (parsed.tasks ?? [parsed]);
          tasks = items.map((item: Record<string, unknown>) => ({
            title:          (item['title'] ?? item['name'] ?? item['task'] ?? 'Untitled') as string,
            description:    (item['description'] ?? item['desc'] ?? '') as string,
            priority:       (['low', 'medium', 'high', 'urgent'].includes(item['priority'] as string)
                              ? item['priority'] : 'medium') as TaskPriority,
            dueDate:        item['dueDate'] ? new Date(item['dueDate'] as string) : undefined,
            estimatedHours: typeof item['estimatedHours'] === 'number' ? item['estimatedHours'] as number : undefined,
            tags:           Array.isArray(item['tags']) ? item['tags'] as string[] : undefined,
            confidence:     1,
          }));
        } else if (ext === 'csv' || ext === 'tsv') {
          const sep = ext === 'tsv' ? '\t' : ',';
          const lines = text.trim().split('\n');
          if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
          const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
          const titleIdx = headers.findIndex(h => ['title', 'name', 'task'].includes(h));
          if (titleIdx === -1) throw new Error('CSV must have a "title" or "name" column');
          const descIdx = headers.findIndex(h => ['description', 'desc'].includes(h));
          const prioIdx = headers.findIndex(h => ['priority'].includes(h));
          const dueIdx  = headers.findIndex(h => ['duedate', 'due_date', 'due'].includes(h));

          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(sep).map(c => c.trim().replace(/^['"]|['"]$/g, ''));
            if (!cols[titleIdx]) continue;
            tasks.push({
              title:       cols[titleIdx],
              description: descIdx >= 0 ? cols[descIdx] : '',
              priority:    prioIdx >= 0 && ['low', 'medium', 'high', 'urgent'].includes(cols[prioIdx])
                             ? cols[prioIdx] as TaskPriority : 'medium',
              dueDate:     dueIdx >= 0 && cols[dueIdx] ? new Date(cols[dueIdx]) : undefined,
              confidence:  1,
            });
          }
        } else {
          throw new Error('Unsupported file format. Use .json or .csv');
        }

        if (tasks.length === 0) throw new Error('No tasks found in file');
        this.extracted.set(tasks);
      } catch (err: unknown) {
        this.error.set(`Import failed: ${(err as Error).message}`);
      }
    };

    reader.readAsText(file);
  }

  // ---- Save Extracted Tasks ----
  async saveExtracted(): Promise<void> {
    this.isProcessing.set(true);
    this.error.set(null);
    try {
      for (const task of this.extracted()) {
        const cat = this.categories.detectCategory(task.title + ' ' + (task.description ?? ''));
        await this.taskService.createTaskFromAi(task, cat?.id);
      }
      this.close.emit();
    } catch (e: unknown) {
      console.error('[Save] failed:', e);
      const msg = (e as any)?.message ?? String(e);
      this.error.set(`Save failed: ${msg}`);
    } finally {
      this.isProcessing.set(false);
    }
  }

  removeExtracted(index: number): void {
    this.extracted.update(list => list.filter((_, i) => i !== index));
  }

  // ---- Manual Form Submit ----
  async submitForm(): Promise<void> {
    if (this.form.invalid) return;
    this.isProcessing.set(true);

    const v = this.form.value;
    try {
      const parentId = await this.taskService.createTask({
        title:           v.title!,
        description:     v.description ?? '',
        status:          'todo',
        priority:        v.priority as TaskPriority ?? 'medium',
        startDate:       v.startDate ? Timestamp.fromDate(new Date(v.startDate)) : null,
        dueDate:         v.dueDate ? Timestamp.fromDate(new Date(v.dueDate)) : null,
        dueTime:         v.dueTime || null,
        estimatedHours:  v.estimatedHours ?? null,
        actualHours:     null,
        categoryIds:     v.categoryId ? [v.categoryId] : [],
        tags:            v.tags ? v.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
        checklist:       [],
        timeBlocks:      [],
        recurrence:      null,
        isScheduled:     false,
        completedAt:     null,
        imageUrl:        null,
        reminders:       [],
        aiMetadata:      { confidence: 1, extractionMethod: 'manual' }
      });
      // Create any subtasks entered in the modal
      for (const st of this.subtaskDrafts()) {
        await this.taskService.createSubtask(parentId, st);
      }
      this.close.emit();
    } finally {
      this.isProcessing.set(false);
    }
  }

  priorityColor(p: TaskPriority): string {
    return { low: '#10b981', medium: '#f59e0b', high: '#f43f5e', urgent: '#ff4444' }[p] ?? '#6366f1';
  }
}
