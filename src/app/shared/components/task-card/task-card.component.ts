import { Component, input, output, inject, computed } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Task, TaskStatus } from '@shared/models/task.model';
import { CategoryService } from '@core/services/category.service';
import { TaskService } from '@core/services/task.service';
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
  taskOpen = output<Task>();

  private readonly categories = inject(CategoryService);
  private readonly taskService = inject(TaskService);

  readonly taskCategories = computed(() =>
    this.task().categoryIds
      .map(id => this.categories.getCategoryById(id))
      .filter(Boolean)
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
