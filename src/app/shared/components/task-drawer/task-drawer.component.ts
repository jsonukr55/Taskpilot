import { Component, input, output, inject, signal, computed, effect, untracked, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { GroupService } from '@core/services/group.service';
import { KeyboardShortcutService } from '@core/services/keyboard-shortcut.service';
import { IconComponent } from '../icon/icon.component';
import { TaskCommentsComponent } from '../task-comments/task-comments.component';
import { ShowPickerDirective } from '@shared/directives/show-picker.directive';
import { Task, TaskStatus, TaskPriority, ChecklistItem } from '@shared/models/task.model';
import { AssignablePerson } from '@shared/models/group.model';
import { Timestamp } from '@angular/fire/firestore';

@Component({
  selector: 'tp-task-drawer',
  standalone: true,
  imports: [FormsModule, IconComponent, TaskCommentsComponent, ShowPickerDirective],
  templateUrl: './task-drawer.component.html',
  styleUrl: './task-drawer.component.scss',
  host: {
    '(document:keydown.escape)': 'close()',
    '(document:click)': 'assignMenuOpen.set(false)'
  }
})
export class TaskDrawerComponent implements OnDestroy {
  task = input.required<Task>();
  /** 'full' = all property editors (default). 'discussion' = title + subtasks
   *  + comments/activity only (used by the board, where fields edit inline). */
  mode = input<'full' | 'discussion'>('full');
  closed = output<void>();

  private readonly taskService = inject(TaskService);
  readonly categories = inject(CategoryService);
  private readonly groups = inject(GroupService);
  private readonly kb = inject(KeyboardShortcutService);
  private readonly disposeShortcuts = this.kb.register({
    keys: 'mod+s', description: 'Save task', group: 'Task editor', allowInInput: true,
    handler: () => this.saveNow(),
  });

  // ---- Assignees ----
  readonly assignMenuOpen  = signal(false);
  readonly assignablePeople = this.groups.assignablePeople;
  readonly assignees = computed<AssignablePerson[]>(() =>
    this.groups.resolveAssignees(this.live().assigneeIds)
  );

  initial(name: string): string { return (name?.charAt(0) || '?').toUpperCase(); }
  toggleAssignMenu(): void { this.assignMenuOpen.update(v => !v); }
  isAssigned(uid: string): boolean { return (this.live().assigneeIds ?? []).includes(uid); }
  async toggleAssignee(uid: string): Promise<void> {
    const current = new Set(this.live().assigneeIds ?? []);
    current.has(uid) ? current.delete(uid) : current.add(uid);
    await this.taskService.setAssignees(this.activeId(), [...current]);
  }

  editTitle       = signal('');
  editDesc        = signal('');
  editStatus      = signal<TaskStatus>('todo');
  editPriority    = signal<TaskPriority>('medium');
  editStartDate   = signal('');
  editDueDate     = signal('');
  editDueTime     = signal('');
  editTags        = signal('');
  editCategoryIds = signal<string[]>([]);
  editEstHours    = signal<number | null>(null);
  newItemText     = signal('');
  newSubtaskTitle = signal('');

  // Est. hours = sum of subtask hours when subtasks provide them, else manual.
  readonly subtaskEstSum = computed(() => this.subtasks().reduce((s, t) => s + (t.estimatedHours ?? 0), 0));
  readonly hasSubtaskEst = computed(() => this.subtasks().some(t => (t.estimatedHours ?? 0) > 0));

  saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');

  private debounceTimer?: ReturnType<typeof setTimeout>;
  private initialized = false;

  readonly allCategories = () => this.categories.rootCategories();

  // Drill-in: when the user opens a subtask, we focus it without leaving
  // the drawer, enabling unlimited nesting (T1 → T1a → T1a1 → …).
  readonly viewId = signal<string | null>(null);
  readonly activeId = computed(() => this.viewId() ?? this.task().id);

  // Live (active) task from the service — reflects updates instantly
  // (the `task` input is a static snapshot that never changes after open).
  readonly live = computed(() => this.taskService.getTaskById(this.activeId()) ?? this.task());

  readonly subtasks = computed(() => this.taskService.getSubtasks(this.activeId()));

  /** Ancestor breadcrumb from the root input task down to the active task. */
  readonly trail = computed(() => {
    const chain: Task[] = [];
    let cur: Task | undefined = this.live();
    const rootId = this.task().id;
    while (cur) {
      chain.unshift(cur);
      if (cur.id === rootId || !cur.parentId) break;
      cur = this.taskService.getTaskById(cur.parentId);
    }
    return chain;
  });

  openSubtask(sub: Task): void { this.viewId.set(sub.id); }
  focusTask(id: string): void { this.viewId.set(id === this.task().id ? null : id); }
  childCount = (id: string): number => this.taskService.getSubtasks(id).length;

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
    // Reset drill-in whenever the drawer is pointed at a new root task.
    effect(() => {
      this.task();
      untracked(() => this.viewId.set(null));
    });
    // (Re)populate edit fields when the active task changes (open or drill-in).
    effect(() => {
      this.activeId();
      untracked(() => {
        const t = this.live();
        this.editTitle.set(t.title);
        this.editDesc.set(t.description ?? '');
        this.editStatus.set(t.status);
        this.editPriority.set(t.priority);
        this.editStartDate.set(t.startDate ? t.startDate.toDate().toISOString().split('T')[0] : '');
        this.editDueDate.set(t.dueDate ? t.dueDate.toDate().toISOString().split('T')[0] : '');
        this.editDueTime.set(t.dueTime ?? '');
        this.editTags.set(t.tags.join(', '));
        this.editCategoryIds.set([...(t.categoryIds ?? [])]);
        this.editEstHours.set(t.estimatedHours ?? null);
        this.saveState.set('idle');
        this.initialized = false;
        setTimeout(() => { this.initialized = true; }, 0);
      });
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.debounceTimer);
    this.disposeShortcuts();
  }

  close(): void { this.closed.emit(); }

  /** Force an immediate save (Ctrl/⌘+S), bypassing the autosave debounce. */
  saveNow(): void {
    clearTimeout(this.debounceTimer);
    void this.flushSave();
  }

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
      await this.taskService.updateTask(this.activeId(), {
        title:       this.editTitle().trim(),
        description: this.editDesc(),
        status:      this.editStatus(),
        priority:    this.editPriority(),
        startDate:   this.editStartDate() ? Timestamp.fromDate(new Date(this.editStartDate())) : null,
        dueDate:     this.editDueDate() ? Timestamp.fromDate(new Date(this.editDueDate())) : null,
        dueTime:     this.editDueTime() || null,
        tags:        this.editTags().split(',').map(t => t.trim()).filter(Boolean),
        categoryIds: this.editCategoryIds(),
        estimatedHours: this.hasSubtaskEst() ? this.subtaskEstSum() : this.editEstHours(),
      });
      this.saveState.set('saved');
      setTimeout(() => this.saveState.set('idle'), 2000);
    } catch {
      this.saveState.set('error');
    }
  }

  async deleteTask(): Promise<void> {
    const active = this.live();
    const isDrilled = active.id !== this.task().id;
    if (!confirm(isDrilled ? 'Delete this subtask?' : 'Delete this task?')) return;
    const parent = active.parentId ?? null;
    await this.taskService.deleteTask(active.id);
    // When deleting a drilled-in subtask, pop back to its parent instead of closing.
    if (isDrilled) this.viewId.set(parent === this.task().id ? null : parent);
    else this.close();
  }

  async toggleChecklist(itemId: string): Promise<void> {
    await this.taskService.toggleChecklistItem(this.activeId(), itemId);
  }

  async addChecklistItem(): Promise<void> {
    const text = this.newItemText().trim();
    if (!text) return;
    await this.taskService.addChecklistItem(this.activeId(), text);
    this.newItemText.set('');
  }

  trackByItem(_: number, item: ChecklistItem): string { return item.id; }

  // ---- Subtasks ----

  async addSubtask(): Promise<void> {
    const title = this.newSubtaskTitle().trim();
    if (!title) return;
    this.newSubtaskTitle.set('');
    await this.taskService.createSubtask(this.activeId(), title);
  }

  async toggleSubtaskStatus(subtask: Task): Promise<void> {
    const next = subtask.status === 'completed' ? 'todo' : 'completed';
    await this.taskService.updateStatus(subtask.id, next);
  }

  async deleteSubtask(id: string): Promise<void> {
    await this.taskService.deleteTask(id);
  }
}
