import { Component, input, output, inject, signal, computed, effect, untracked, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { GroupService } from '@core/services/group.service';
import { KeyboardShortcutService } from '@core/services/keyboard-shortcut.service';
import { DialogService } from '@core/services/dialog.service';
import { ToastService } from '@core/services/toast.service';
import { IconComponent } from '../icon/icon.component';
import { MenuComponent, MenuItem } from '../menu/menu.component';
import { TaskCommentsComponent } from '../task-comments/task-comments.component';
import { TaskAttachmentsComponent } from '../task-attachments/task-attachments.component';
import { ShowPickerDirective } from '@shared/directives/show-picker.directive';
import { TooltipDirective } from '@shared/directives/tooltip.directive';
import { Task, TaskStatus, TaskPriority, ChecklistItem } from '@shared/models/task.model';
import { AssignablePerson } from '@shared/models/group.model';
import { Timestamp } from '@angular/fire/firestore';

@Component({
  selector: 'tp-task-drawer',
  standalone: true,
  imports: [
    FormsModule, IconComponent, MenuComponent, TaskCommentsComponent,
    TaskAttachmentsComponent, ShowPickerDirective, TooltipDirective,
  ],
  templateUrl: './task-drawer.component.html',
  styleUrl: './task-drawer.component.scss',
  host: {
    '(document:keydown.escape)': 'close()',
    '(document:click)': 'closeMenus()'
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
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly disposeShortcuts = this.kb.register({
    keys: 'mod+s', description: 'Save task', group: 'Task editor', allowInInput: true,
    handler: () => this.saveNow(),
  });

  /** Segmented controls in the header — one click per value, no dropdown. */
  readonly STATUSES: { value: TaskStatus; label: string; icon: string }[] = [
    { value: 'todo',        label: 'Open',        icon: 'circle' },
    { value: 'in_progress', label: 'In progress', icon: 'play-circle' },
    { value: 'completed',   label: 'Done',        icon: 'check-circle' },
  ];
  readonly PRIORITIES: { value: TaskPriority; label: string }[] = [
    { value: 'low',    label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high',   label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];

  // ---- Assignees ----
  readonly assignMenuOpen  = signal(false);
  readonly assignablePeople = this.groups.assignablePeople;
  readonly assignees = computed<AssignablePerson[]>(() =>
    this.groups.resolveAssignees(this.live().assigneeIds)
  );

  initial(name: string): string { return (name?.charAt(0) || '?').toUpperCase(); }
  toggleAssignMenu(): void { this.catMenuOpen.set(false); this.assignMenuOpen.update(v => !v); }
  isAssigned(uid: string): boolean { return (this.live().assigneeIds ?? []).includes(uid); }
  async toggleAssignee(uid: string): Promise<void> {
    const current = new Set(this.live().assigneeIds ?? []);
    current.has(uid) ? current.delete(uid) : current.add(uid);
    await this.taskService.setAssignees(this.activeId(), [...current]);
  }

  /** Both popovers close on any outside click (host listener). */
  closeMenus(): void { this.assignMenuOpen.set(false); this.catMenuOpen.set(false); }

  editTitle       = signal('');
  editDesc        = signal('');
  editStatus      = signal<TaskStatus>('todo');
  editPriority    = signal<TaskPriority>('medium');
  editStartDate   = signal('');
  editDueDate     = signal('');
  editDueTime     = signal('');
  editTags        = signal<string[]>([]);
  editCategoryIds = signal<string[]>([]);
  editEstHours    = signal<number | null>(null);
  newTag          = signal('');
  newItemText     = signal('');
  newSubtaskTitle = signal('');

  // Est. hours = sum of subtask hours when subtasks provide them, else manual.
  readonly subtaskEstSum = computed(() => this.subtasks().reduce((s, t) => s + (t.estimatedHours ?? 0), 0));
  readonly hasSubtaskEst = computed(() => this.subtasks().some(t => (t.estimatedHours ?? 0) > 0));

  saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');

  private debounceTimer?: ReturnType<typeof setTimeout>;
  private initialized = false;

  readonly allCategories = () => this.categories.rootCategories();

  // ---- Categories ----
  readonly catMenuOpen = signal(false);
  toggleCatMenu(): void { this.assignMenuOpen.set(false); this.catMenuOpen.update(v => !v); }
  readonly selectedCategories = computed(() => {
    const ids = this.editCategoryIds();
    return this.allCategories().filter(c => ids.includes(c.id));
  });

  // Drill-in: when the user opens a subtask, we focus it without leaving
  // the drawer, enabling unlimited nesting (T1 → T1a → T1a1 → …).
  readonly viewId = signal<string | null>(null);
  readonly activeId = computed(() => this.viewId() ?? this.task().id);
  readonly isDrilled = computed(() => this.activeId() !== this.task().id);

  // Live (active) task from the service — reflects updates instantly
  // (the `task` input is a static snapshot that never changes after open).
  readonly live = computed(() => this.taskService.getTaskById(this.activeId()) ?? this.task());

  readonly subtasks = computed(() => this.taskService.getSubtasks(this.activeId()));

  /** Header "⋯" actions — destructive work lives here, not in the chrome. */
  readonly menuItems = computed<MenuItem[]>(() => [
    { label: 'Duplicate', icon: 'copy', action: () => void this.duplicate() },
    {
      label: this.isDrilled() ? 'Delete subtask' : 'Delete task',
      icon: 'trash-2', danger: true, action: () => void this.deleteTask(),
    },
  ]);

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

  /** Reads the edited fields, so the red state tracks the picker immediately. */
  readonly isOverdue = computed(() => {
    const due = this.editDueDate();
    if (!due || this.editStatus() === 'completed') return false;
    return new Date(due) < new Date();
  });

  /** Short "x ago" label for the footer stamps. */
  timeAgo(ts?: Timestamp | null): string {
    if (!ts) return '';
    const min = Math.round((Date.now() - ts.toMillis()) / 60_000);
    if (min < 1)  return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24)  return `${hr}h ago`;
    const d = Math.round(hr / 24);
    if (d < 7)    return `${d}d ago`;
    return ts.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

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
        this.editTags.set([...t.tags]);
        this.editCategoryIds.set([...(t.categoryIds ?? [])]);
        this.editEstHours.set(t.estimatedHours ?? null);
        this.newTag.set('');
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
    this.editCategoryIds.update(ids =>
      ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
    );
    this.scheduleAutoSave();
  }

  // ---- Tags (chip editor) ----

  /** Commits whatever is typed; a comma-separated burst becomes several tags. */
  addTag(): void {
    const parts = this.newTag().split(',').map(t => t.trim()).filter(Boolean);
    this.newTag.set('');
    if (!parts.length) return;
    this.editTags.update(tags => [...new Set([...tags, ...parts])]);
    this.scheduleAutoSave();
  }

  removeTag(tag: string): void {
    this.editTags.update(tags => tags.filter(t => t !== tag));
    this.scheduleAutoSave();
  }

  /** Backspace in an empty input pops the last chip (standard chip-input feel). */
  onTagBackspace(): void {
    if (this.newTag() || !this.editTags().length) return;
    this.editTags.update(tags => tags.slice(0, -1));
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
        tags:        this.editTags(),
        categoryIds: this.editCategoryIds(),
        estimatedHours: this.hasSubtaskEst() ? this.subtaskEstSum() : this.editEstHours(),
      });
      this.saveState.set('saved');
      setTimeout(() => this.saveState.set('idle'), 2000);
    } catch {
      this.saveState.set('error');
    }
  }

  async duplicate(): Promise<void> {
    const id = await this.taskService.duplicateTask(this.activeId());
    if (id) this.toast.success('Task duplicated');
    else    this.toast.error('Could not duplicate this task');
  }

  async deleteTask(): Promise<void> {
    const active = this.live();
    const isDrilled = active.id !== this.task().id;
    if (!(await this.dialog.confirm({ title: isDrilled ? 'Delete subtask' : 'Delete task', message: isDrilled ? 'Delete this subtask?' : 'Delete this task?', confirmText: 'Delete', danger: true }))) return;
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

  async removeChecklistItem(itemId: string): Promise<void> {
    await this.taskService.removeChecklistItem(this.activeId(), itemId);
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
