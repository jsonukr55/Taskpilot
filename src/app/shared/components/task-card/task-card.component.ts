import { Component, input, output, inject, computed, signal, HostListener } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Task, TaskStatus } from '@shared/models/task.model';
import { CategoryService } from '@core/services/category.service';
import { TaskService } from '@core/services/task.service';
import { GroupService } from '@core/services/group.service';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '../icon/icon.component';

/** A person who can be assigned to a task (self + members of any shared group). */
interface AssignablePerson {
  uid:         string;
  displayName: string;
  photoURL:    string | null;
  isSelf:      boolean;
}

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
  taskOpen   = output<Task>();
  addSubtask = output<Task>();

  private readonly categories  = inject(CategoryService);
  private readonly taskService = inject(TaskService);
  private readonly groups      = inject(GroupService);
  private readonly auth        = inject(AuthService);

  /** Is the assignee picker open for this row? */
  readonly assignMenuOpen = signal(false);

  readonly subtaskCount = computed(() => this.taskService.getSubtasks(this.task().id).length);

  readonly taskCategories = computed(() =>
    this.task().categoryIds
      .map(id => this.categories.getCategoryById(id))
      .filter(Boolean)
  );

  /** Everyone the user can assign work to: themselves + members of every shared group. */
  readonly assignablePeople = computed<AssignablePerson[]>(() => {
    const uid = this.auth.userId();
    const byUid = new Map<string, AssignablePerson>();

    if (uid) {
      byUid.set(uid, {
        uid,
        displayName: this.auth.displayName() || 'You',
        photoURL:    this.auth.photoURL(),
        isSelf:      true
      });
    }

    for (const group of this.groups.groups()) {
      for (const memberId of group.memberIds) {
        if (byUid.has(memberId)) continue;
        const profile = group.memberProfiles[memberId];
        byUid.set(memberId, {
          uid:         memberId,
          displayName: profile?.displayName ?? 'Member',
          photoURL:    profile?.photoURL ?? null,
          isSelf:      false
        });
      }
    }

    return [...byUid.values()].sort((a, b) =>
      a.isSelf ? -1 : b.isSelf ? 1 : a.displayName.localeCompare(b.displayName)
    );
  });

  /** The people currently assigned to this task, resolved to display info. */
  readonly assignees = computed<AssignablePerson[]>(() => {
    const ids = this.task().assigneeIds ?? [];
    if (!ids.length) return [];
    const lookup = new Map(this.assignablePeople().map(p => [p.uid, p]));
    return ids.map(id => lookup.get(id) ?? {
      uid:         id,
      displayName: 'Member',
      photoURL:    null,
      isSelf:      false
    });
  });

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
    this.assignMenuOpen.update(open => !open);
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
    if (this.assignMenuOpen()) this.assignMenuOpen.set(false);
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
