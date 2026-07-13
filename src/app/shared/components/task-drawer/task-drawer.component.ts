import { Component, input, output, inject, signal, computed, effect, untracked, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { IconComponent } from '../icon/icon.component';
import { Task, TaskStatus, TaskPriority, ChecklistItem } from '@shared/models/task.model';
import { Timestamp } from '@angular/fire/firestore';

@Component({
  selector: 'tp-task-drawer',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './task-drawer.component.html',
  styleUrl: './task-drawer.component.scss',
  host: { '(document:keydown.escape)': 'close()' }
})
export class TaskDrawerComponent implements OnDestroy {
  task = input.required<Task>();
  closed = output<void>();

  private readonly taskService = inject(TaskService);
  readonly categories = inject(CategoryService);

  editTitle       = signal('');
  editDesc        = signal('');
  editStatus      = signal<TaskStatus>('todo');
  editPriority    = signal<TaskPriority>('medium');
  editStartDate   = signal('');
  editDueDate     = signal('');
  editDueTime     = signal('');
  editTags        = signal('');
  editCategoryIds = signal<string[]>([]);
  newItemText     = signal('');
  newSubtaskTitle = signal('');

  saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');

  private debounceTimer?: ReturnType<typeof setTimeout>;
  private initialized = false;

  readonly allCategories = () => this.categories.rootCategories();

  // Live task from the service — reflects Firestore updates instantly
  // (the `task` input is a static snapshot that never changes after open).
  readonly live = computed(() => this.taskService.getTaskById(this.task().id) ?? this.task());

  readonly subtasks = computed(() => this.taskService.getSubtasks(this.task().id));

  readonly subtaskProgress = computed(() => {
    const subs = this.subtasks();
    if (!subs.length) return null;
    const done = subs.filter(s => s.status === 'completed').length;
    return { done, total: subs.length, pct: Math.round((done / subs.length) * 100) };
  });

  readonly checklistProgress = computed(() => {
    const items = this.live().checklist;
    if (!items.length) return null;
    const done = items.filter(i => i.completed).length;
    return { done, total: items.length, pct: Math.round((done / items.length) * 100) };
  });

  readonly isOverdue = () => {
    const t = this.task();
    if (!t.dueDate || t.status === 'completed') return false;
    return t.dueDate.toDate() < new Date();
  };

  constructor() {
    effect(() => {
      const t = this.task();
      untracked(() => {
        this.editTitle.set(t.title);
        this.editDesc.set(t.description ?? '');
        this.editStatus.set(t.status);
        this.editPriority.set(t.priority);
        this.editStartDate.set(t.startDate ? t.startDate.toDate().toISOString().split('T')[0] : '');
        this.editDueDate.set(t.dueDate ? t.dueDate.toDate().toISOString().split('T')[0] : '');
        this.editDueTime.set(t.dueTime ?? '');
        this.editTags.set(t.tags.join(', '));
        this.editCategoryIds.set([...(t.categoryIds ?? [])]);
        this.saveState.set('idle');
        this.initialized = false;
        setTimeout(() => { this.initialized = true; }, 0);
      });
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.debounceTimer);
  }

  close(): void { this.closed.emit(); }

  scheduleAutoSave(): void {
    if (!this.initialized || !this.editTitle().trim()) return;
    clearTimeout(this.debounceTimer);
    this.saveState.set('saving');
    this.debounceTimer = setTimeout(() => this.flushSave(), 800);
  }

  async saveImmediate(field: 'status', value: TaskStatus): Promise<void>;
  async saveImmediate(field: 'priority', value: TaskPriority): Promise<void>;
  async saveImmediate(field: string, value: unknown): Promise<void> {
    if (field === 'status')   this.editStatus.set(value as TaskStatus);
    if (field === 'priority') this.editPriority.set(value as TaskPriority);
    clearTimeout(this.debounceTimer);
    await this.flushSave();
  }

  toggleCategory(id: string): void {
    this.editCategoryIds.update(ids => {
      const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
      return next;
    });
    this.scheduleAutoSave();
  }

  private async flushSave(): Promise<void> {
    if (!this.editTitle().trim()) return;
    this.saveState.set('saving');
    try {
      await this.taskService.updateTask(this.task().id, {
        title:       this.editTitle().trim(),
        description: this.editDesc(),
        status:      this.editStatus(),
        priority:    this.editPriority(),
        startDate:   this.editStartDate() ? Timestamp.fromDate(new Date(this.editStartDate())) : null,
        dueDate:     this.editDueDate() ? Timestamp.fromDate(new Date(this.editDueDate())) : null,
        dueTime:     this.editDueTime() || null,
        tags:        this.editTags().split(',').map(t => t.trim()).filter(Boolean),
        categoryIds: this.editCategoryIds(),
      });
      this.saveState.set('saved');
      setTimeout(() => this.saveState.set('idle'), 2000);
    } catch {
      this.saveState.set('error');
    }
  }

  async deleteTask(): Promise<void> {
    if (!confirm('Delete this task?')) return;
    await this.taskService.deleteTask(this.task().id);
    this.close();
  }

  async toggleChecklist(itemId: string): Promise<void> {
    await this.taskService.toggleChecklistItem(this.task().id, itemId);
  }

  async addChecklistItem(): Promise<void> {
    const text = this.newItemText().trim();
    if (!text) return;
    await this.taskService.addChecklistItem(this.task().id, text);
    this.newItemText.set('');
  }

  trackByItem(_: number, item: ChecklistItem): string { return item.id; }

  // ---- Subtasks ----

  async addSubtask(): Promise<void> {
    const title = this.newSubtaskTitle().trim();
    if (!title) return;
    this.newSubtaskTitle.set('');
    await this.taskService.createSubtask(this.task().id, title);
  }

  async toggleSubtaskStatus(subtask: Task): Promise<void> {
    const next = subtask.status === 'completed' ? 'todo' : 'completed';
    await this.taskService.updateStatus(subtask.id, next);
  }

  async deleteSubtask(id: string): Promise<void> {
    await this.taskService.deleteTask(id);
  }
}
