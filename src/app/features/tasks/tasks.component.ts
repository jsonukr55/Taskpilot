import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TaskService, TaskFilter, TaskSortOption } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { TaskCardComponent } from '@shared/components/task-card/task-card.component';
import { TaskDrawerComponent } from '@shared/components/task-drawer/task-drawer.component';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';
import { CreateTaskModalComponent } from './create-task-modal/create-task-modal.component';
import { Task, TaskPriority, TaskStatus } from '@shared/models/task.model';

type ViewMode = 'list' | 'board';

@Component({
  selector:   'tp-tasks',
  standalone: true,
  imports:    [FormsModule, TaskCardComponent, TaskDrawerComponent, IconComponent, TooltipDirective, CreateTaskModalComponent],
  templateUrl: './tasks.component.html',
  styleUrl:    './tasks.component.scss'
})
export class TasksComponent implements OnInit {
  readonly taskService   = inject(TaskService);
  readonly categories    = inject(CategoryService);
  private readonly route = inject(ActivatedRoute);

  readonly viewMode        = signal<ViewMode>('list');
  readonly showCreateModal = signal(false);
  readonly selectedIds     = signal<Set<string>>(new Set());
  readonly selectedTask    = signal<Task | null>(null);
  readonly collapsedGroups = signal<Set<TaskStatus>>(new Set());

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
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
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

  toggleOverdue(): void {
    this.taskService.filter.update(f => ({ ...f, isOverdue: !f.isOverdue }));
  }

  toggleView(): void {
    this.viewMode.update(v => v === 'list' ? 'board' : 'list');
  }

  toggleSelect(id: string): void {
    this.selectedIds.update(set => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async bulkComplete(): Promise<void> {
    const ids = [...this.selectedIds()];
    await this.taskService.bulkUpdateStatus(ids, 'completed');
    this.selectedIds.set(new Set());
  }

  async bulkDelete(): Promise<void> {
    if (!confirm(`Delete ${this.selectedIds().size} tasks?`)) return;
    await this.taskService.bulkDelete([...this.selectedIds()]);
    this.selectedIds.set(new Set());
  }

  clearFilter(): void {
    this.taskService.filter.set({});
    this.taskService.searchQuery.set('');
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
