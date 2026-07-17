import { Component, input, output, inject, computed, signal, HostListener } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Task, TaskStatus } from '@shared/models/task.model';
import { CategoryService } from '@core/services/category.service';
import { TaskService } from '@core/services/task.service';
import { GroupService } from '@core/services/group.service';
import { AssignablePerson } from '@shared/models/group.model';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector:   'tp-task-card',
  standalone: true,
  imports:    [IconComponent],
  templateUrl: './task-card.component.html',
  styleUrl:    './task-card.component.scss'
})
export class TaskCardComponent {
  task    = input.required<Task>();
  compact = input(false);
  /** Opt-in multi-select mode: shows a selection checkbox (default off). */
  selectable = input(false);
  selected   = input(false);
  /** Keyboard-navigation highlight (default off). */
  active     = input(false);
  taskOpen     = output<Task>();
  addSubtask   = output<Task>();
  selectChange = output<Task>();

  private readonly categories  = inject(CategoryService);
  private readonly taskService = inject(TaskService);
  private readonly groups      = inject(GroupService);

  // Which task's assignee picker is open — shared across ALL cards so only one
  // menu is ever open. Clicking a different row's trigger closes the previous.
  private static readonly openMenuTaskId = signal<string | null>(null);

  /** Is the assignee picker open for this row? */
  readonly assignMenuOpen = computed(() =>
    TaskCardComponent.openMenuTaskId() === this.task().id
  );

  readonly subtaskCount = computed(() => this.taskService.getSubtasks(this.task().id).length);

  readonly taskCategories = computed(() =>
    this.task().categoryIds
      .map(id => this.categories.getCategoryById(id))
      .filter(Boolean)
  );

  /** Everyone the user can assign work to: themselves + members of every shared group. */
  readonly assignablePeople = this.groups.assignablePeople;

  /** The people currently assigned to this task, resolved to display info. */
  readonly assignees = computed<AssignablePerson[]>(() =>
    this.groups.resolveAssignees(this.task().assigneeIds)
  );

  readonly isOverdue = computed(() => {
    const t = this.task();
    if (!t.dueDate || t.status === 'completed') return false;
    return t.dueDate.toDate() < new Date();
  });

  readonly dueDateLabel = computed(() => {
    const t = this.task();
    if (!t.dueDate) return null;
    const due = t.dueDate.toDate();
    const now  = new Date();
    const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);

    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days <= 7)  return `${days}d left`;
    return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  readonly checklistProgress = computed(() => {
    const items = this.task().checklist;
    if (!items.length) return null;
    const done = items.filter(i => i.completed).length;
    return { done, total: items.length, pct: Math.round((done / items.length) * 100) };
  });

  initial(name: string): string {
    return (name?.charAt(0) || '?').toUpperCase();
  }

  toggleAssignMenu(): void {
    const id = this.task().id;
    TaskCardComponent.openMenuTaskId.update(open => open === id ? null : id);
  }

  isAssigned(uid: string): boolean {
    return (this.task().assigneeIds ?? []).includes(uid);
  }

  async toggleAssignee(uid: string): Promise<void> {
    const current = new Set(this.task().assigneeIds ?? []);
    current.has(uid) ? current.delete(uid) : current.add(uid);
    await this.taskService.setAssignees(this.task().id, [...current]);
  }

  /** Close the assignee menu when the user clicks anywhere outside this card. */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.assignMenuOpen()) TaskCardComponent.openMenuTaskId.set(null);
  }

  async toggleStatus(): Promise<void> {
    const task = this.task();
    const next: TaskStatus = task.status === 'completed' ? 'todo' : 'completed';
    await this.taskService.updateStatus(task.id, next);
  }

  formatDate(ts: Timestamp): string {
    const d = ts.toDate();
    const now = new Date();
    const days = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
