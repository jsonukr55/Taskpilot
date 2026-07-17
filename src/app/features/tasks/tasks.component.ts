import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Timestamp } from '@angular/fire/firestore';
import { TaskService, TaskFilter, TaskSortOption } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { GroupService } from '@core/services/group.service';
import { ToastService } from '@core/services/toast.service';
import { KeyboardShortcutService } from '@core/services/keyboard-shortcut.service';
import { SmartFilterService } from '@core/services/smart-filter.service';
import { FilterPreset } from '@shared/models/filter-preset.model';
import { TaskCardComponent } from '@shared/components/task-card/task-card.component';
import { TaskDrawerComponent } from '@shared/components/task-drawer/task-drawer.component';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';
import { SelectComponent, SelectOption } from '@shared/components/select/select.component';
import { CreateTaskModalComponent } from './create-task-modal/create-task-modal.component';
import { Task, TaskPriority, TaskStatus } from '@shared/models/task.model';

type ViewMode = 'list' | 'board';

@Component({
  selector:   'tp-tasks',
  standalone: true,
  imports:    [FormsModule, TaskCardComponent, TaskDrawerComponent, IconComponent, TooltipDirective, CreateTaskModalComponent, SelectComponent],
  templateUrl: './tasks.component.html',
  styleUrl:    './tasks.component.scss'
})
export class TasksComponent implements OnInit, OnDestroy {
  readonly taskService   = inject(TaskService);
  readonly categories    = inject(CategoryService);
  private readonly groups = inject(GroupService);
  private readonly toast = inject(ToastService);
  private readonly kb    = inject(KeyboardShortcutService);
  readonly smart = inject(SmartFilterService);
  private readonly route = inject(ActivatedRoute);

  readonly viewMode        = signal<ViewMode>('list');
  readonly showCreateModal = signal(false);
  readonly selectionMode   = signal(false);
  readonly selectedIds     = signal<Set<string>>(new Set());
  // Pulsed after each bulk action so the bulk-bar dropdowns reset to their
  // placeholder (alternating ''/null both render as the placeholder).
  readonly bulkReset       = signal<string | null>('');
  readonly selectedTask    = signal<Task | null>(null);
  readonly collapsedGroups = signal<Set<TaskStatus>>(new Set());

  // Inline "add subtask" on a row
  readonly addingSubtaskFor = signal<string | null>(null);
  readonly subtaskDraft     = signal('');

  startAddSubtask(task: Task): void {
    this.addingSubtaskFor.set(task.id);
    this.subtaskDraft.set('');
  }
  async confirmSubtask(parentId: string): Promise<void> {
    const title = this.subtaskDraft().trim();
    if (!title) return;
    this.subtaskDraft.set('');
    await this.taskService.createSubtask(parentId, title);
  }
  closeSubtaskAdd(): void {
    this.addingSubtaskFor.set(null);
    this.subtaskDraft.set('');
  }
  subtasksOf(parentId: string): Task[] {
    return this.taskService.getSubtasks(parentId);
  }

  toggleGroup(status: TaskStatus): void {
    this.collapsedGroups.update(s => {
      const next = new Set(s);
      next.has(status) ? next.delete(status) : next.add(status);
      return next;
    });
  }

  readonly statusGroups = computed(() => {
    const statuses: TaskStatus[] = ['todo', 'in_progress', 'completed'];
    return statuses.map(status => ({
      status,
      label: status === 'in_progress' ? 'In Progress' : status === 'todo' ? 'To Do' : 'Done',
      tasks: this.taskService.filteredTasks().filter(t => t.status === status)
    }));
  });

  readonly priorityOptions: { value: TaskPriority; label: string }[] = [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high',   label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low',    label: 'Low' }
  ];

  // ---- Filter dropdown options (tp-select) ----
  readonly categoryFilterOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'All categories' },
    ...this.categories.rootCategories().map(c => ({ value: c.id, label: c.name, icon: c.icon })),
  ]);
  readonly priorityFilterOptions: SelectOption[] = [
    { value: '', label: 'All priorities' },
    ...this.priorityOptions,
  ];
  readonly assigneeFilterOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'All assignees' },
    ...this.groups.assignablePeople().map(p => ({
      value: p.uid,
      label: p.isSelf ? 'Me' : p.displayName,
    })),
  ]);
  readonly currentCategoryFilter = computed(() => this.taskService.filter().categoryIds?.[0] ?? '');
  readonly currentPriorityFilter = computed(() => this.taskService.filter().priority?.[0] ?? '');
  readonly currentAssigneeFilter = computed(() => this.taskService.filter().assigneeId ?? '');

  // ---- Keyboard navigation ----
  readonly activeId = signal<string | null>(null);
  private disposeShortcuts?: () => void;

  /** Nav/action shortcuts only apply while no modal/drawer is open. */
  private pageActive = (): boolean => !this.showCreateModal() && !this.selectedTask();

  ngOnInit(): void {
    // Open create modal if ?new=true
    this.route.queryParams.subscribe(params => {
      if (params['new']) this.showCreateModal.set(true);
      if (params['category']) {
        this.taskService.filter.update(f => ({
          ...f,
          categoryIds: [params['category']]
        }));
      }
    });

    this.disposeShortcuts = this.kb.registerAll([
      { keys: 'arrowdown', description: 'Next task',       group: 'Tasks', when: this.pageActive, handler: () => this.moveActive(1) },
      { keys: 'arrowup',   description: 'Previous task',   group: 'Tasks', when: this.pageActive, handler: () => this.moveActive(-1) },
      { keys: 'enter',     description: 'Open task',       group: 'Tasks', when: () => this.pageActive() && !!this.activeId(), handler: () => this.openActive() },
      { keys: 'e',         description: 'Quick edit task', group: 'Tasks', when: () => this.pageActive() && !!this.activeId(), handler: () => this.openActive() },
      { keys: 'd',         description: 'Duplicate task',  group: 'Tasks', when: () => this.pageActive() && !!this.activeId(), handler: () => { void this.duplicateActive(); } },
      { keys: 'x',         description: 'Select task',     group: 'Tasks', when: () => this.pageActive() && !!this.activeId(), handler: () => this.toggleSelectActive() },
      { keys: ['delete', 'backspace'], description: 'Delete task', group: 'Tasks', when: () => this.pageActive() && !!this.activeId(), handler: () => { void this.deleteActive(); } },
      { keys: 'escape', when: () => this.pageActive() && (this.selectionMode() || this.activeId() !== null), handler: () => this.onEscape() },
    ]);
  }

  ngOnDestroy(): void {
    this.disposeShortcuts?.();
  }

  private activeTask(): Task | undefined {
    const id = this.activeId();
    return id ? this.taskService.filteredTasks().find(t => t.id === id) : undefined;
  }

  private moveActive(delta: number): void {
    const list = this.taskService.filteredTasks();
    if (!list.length) return;
    const idx = list.findIndex(t => t.id === this.activeId());
    const next = idx < 0
      ? (delta > 0 ? 0 : list.length - 1)
      : Math.min(Math.max(idx + delta, 0), list.length - 1);
    const task = list[next];
    this.activeId.set(task.id);
    // Scroll the newly-active row into view if it's offscreen.
    setTimeout(() => document.querySelector(`[data-taskid="${task.id}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
  }

  private openActive(): void {
    const task = this.activeTask();
    if (task) this.selectedTask.set(task);
  }

  private async duplicateActive(): Promise<void> {
    const task = this.activeTask();
    if (!task) return;
    try {
      await this.taskService.duplicateTask(task.id);
      this.toast.success('Task duplicated');
    } catch {
      this.toast.error('Couldn\'t duplicate task');
    }
  }

  private toggleSelectActive(): void {
    const task = this.activeTask();
    if (!task) return;
    if (!this.selectionMode()) this.selectionMode.set(true);
    this.toggleSelect(task);
  }

  private async deleteActive(): Promise<void> {
    const task = this.activeTask();
    if (!task) return;
    // Advance the highlight before the row disappears.
    this.moveActive(1);
    if (this.activeId() === task.id) this.activeId.set(null);
    try {
      await this.taskService.deleteTask(task.id);
      this.toast.success('Task deleted');
    } catch {
      this.toast.error('Couldn\'t delete task');
    }
  }

  private onEscape(): void {
    if (this.selectionMode()) { this.toggleSelectionMode(); return; }
    this.activeId.set(null);
  }

  // ---- Multi-selection & bulk operations ----

  /** All top-level task ids currently visible under the active filter. */
  readonly visibleTaskIds = computed(() => this.taskService.filteredTasks().map(t => t.id));
  readonly selectedCount  = computed(() => this.selectedIds().size);
  readonly allVisibleSelected = computed(() => {
    const visible = this.visibleTaskIds();
    const sel = this.selectedIds();
    return visible.length > 0 && visible.every(id => sel.has(id));
  });

  // Bulk-bar dropdown options (leading placeholder resets after each pick).
  readonly bulkStatusOptions: SelectOption[] = [
    { value: '',            label: 'Set status…' },
    { value: 'todo',        label: 'To do' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'completed',   label: 'Done' },
    { value: 'cancelled',   label: 'Archive (cancel)' },
  ];
  readonly bulkPriorityOptions: SelectOption[] = [
    { value: '', label: 'Set priority…' },
    ...this.priorityOptions,
  ];
  readonly bulkCategoryOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Add category…' },
    ...this.categories.rootCategories().map(c => ({ value: c.id, label: c.name, icon: c.icon })),
  ]);

  toggleSelectionMode(): void {
    this.selectionMode.update(on => !on);
    if (!this.selectionMode()) this.clearSelection();
  }

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  selectAllVisible(): void {
    this.selectedIds.set(new Set(this.visibleTaskIds()));
  }

  /** Runs a bulk action optimistically: selection clears instantly, then
   *  a success/error toast confirms the outcome once Firestore responds. */
  private async runBulk(op: (ids: string[]) => Promise<void>, verb: string): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    this.clearSelection();
    this.bulkReset.update(v => (v === '' ? null : ''));   // reset bulk dropdowns
    const noun = `${ids.length} task${ids.length === 1 ? '' : 's'}`;
    try {
      await op(ids);
      this.toast.success(`${verb} ${noun}`);
    } catch {
      this.toast.error(`Couldn't ${verb.toLowerCase()} ${noun}`);
    }
  }

  bulkComplete(): Promise<void> {
    return this.runBulk(ids => this.taskService.bulkComplete(ids), 'Completed');
  }

  bulkDelete(): Promise<void> {
    const n = this.selectedIds().size;
    if (!n || !confirm(`Delete ${n} task${n === 1 ? '' : 's'}? This cannot be undone.`)) {
      return Promise.resolve();
    }
    return this.runBulk(ids => this.taskService.bulkDelete(ids), 'Deleted');
  }

  onBulkStatus(value: string): void {
    switch (value as TaskStatus) {
      case 'completed':   this.runBulk(ids => this.taskService.bulkComplete(ids), 'Completed'); break;
      case 'todo':        this.runBulk(ids => this.taskService.bulkRestore(ids),  'Restored');  break;
      case 'cancelled':   this.runBulk(ids => this.taskService.bulkArchive(ids),  'Archived');  break;
      case 'in_progress': this.runBulk(ids => this.taskService.bulkUpdateStatus(ids, 'in_progress'), 'Updated'); break;
    }
  }

  onBulkPriority(value: string): void {
    if (!value) return;
    this.runBulk(ids => this.taskService.bulkSetPriority(ids, value as TaskPriority), 'Set priority on');
  }

  onBulkCategory(value: string): void {
    if (!value) return;
    this.runBulk(ids => this.taskService.bulkSetCategories(ids, [value], 'add'), 'Updated categories on');
  }

  onBulkDueDate(value: string): void {
    const due = value ? Timestamp.fromDate(new Date(`${value}T00:00:00`)) : null;
    this.runBulk(ids => this.taskService.bulkSetDueDate(ids, due), value ? 'Set due date on' : 'Cleared due date on');
  }

  onCategoryFilter(value: string): void {
    this.taskService.filter.update(f => ({ ...f, categoryIds: value ? [value] : undefined }));
  }

  onPriorityFilter(value: string): void {
    this.taskService.filter.update(f => ({
      ...f,
      priority: value ? [value as TaskPriority] : undefined
    }));
  }

  onAssigneeFilter(value: string): void {
    this.taskService.filter.update(f => ({ ...f, assigneeId: value || undefined }));
  }

  toggleOverdue(): void {
    this.taskService.filter.update(f => ({ ...f, isOverdue: !f.isOverdue }));
  }

  toggleView(): void {
    this.viewMode.update(v => v === 'list' ? 'board' : 'list');
  }

  toggleSelect(task: Task): void {
    this.selectedIds.update(set => {
      const next = new Set(set);
      next.has(task.id) ? next.delete(task.id) : next.add(task.id);
      return next;
    });
  }

  clearFilter(): void {
    this.smart.clear();
  }

  applyPreset(preset: FilterPreset): void {
    this.smart.apply(preset);
  }

  saveCurrentFilter(): void {
    const name = prompt('Name this filter:');
    if (name?.trim()) {
      this.smart.saveCurrent(name.trim());
      this.toast.success('Filter saved');
    }
  }

  updateSort(field: TaskSortOption['field']): void {
    this.taskService.sort.update(s =>
      s.field === field
        ? { ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'asc' }
    );
  }

  trackByTask(_: number, t: Task): string { return t.id; }
}
