import { Component, OnInit, inject, signal, computed, input } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { SchedulingService } from '@core/services/scheduling.service';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { SelectComponent, SelectOption } from '@shared/components/select/select.component';
import { ShowPickerDirective } from '@shared/directives/show-picker.directive';
import { Task, TaskStatus, TaskPriority, ChecklistItem } from '@shared/models/task.model';
import { Timestamp } from '@angular/fire/firestore';

@Component({
  selector:   'tp-task-detail',
  standalone: true,
  imports:    [RouterLink, FormsModule, ReactiveFormsModule, DatePipe, DecimalPipe, IconComponent, ShowPickerDirective, SelectComponent],
  templateUrl: './task-detail.component.html',
  styleUrl:    './task-detail.component.scss'
})
export class TaskDetailComponent implements OnInit {
  id = input.required<string>();

  private readonly taskService  = inject(TaskService);
  private readonly categories   = inject(CategoryService);
  private readonly scheduling   = inject(SchedulingService);
  private readonly auth         = inject(AuthService);
  private readonly router       = inject(Router);
  private readonly fb           = inject(FormBuilder);

  readonly task        = computed(() => this.taskService.getTaskById(this.id()));
  readonly isEditing   = signal(false);
  readonly isSaving    = signal(false);
  readonly newItemText = signal('');

  readonly taskCategories = computed(() =>
    (this.task()?.categoryIds ?? []).map(id => this.categories.getCategoryById(id)).filter(Boolean)
  );

  readonly allCategories = computed(() => this.categories.rootCategories());

  readonly statusOptions: SelectOption[] = [
    { value: 'todo',        label: 'To Do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed',   label: 'Completed' },
  ];
  readonly priorityOptions: SelectOption[] = [
    { value: 'low',    label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high',   label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];
  readonly completedChecklistCount = computed(() =>
    this.task()?.checklist.filter(i => i.completed).length ?? 0
  );

  readonly editForm = this.fb.group({
    title:          [''],
    description:    [''],
    priority:       ['medium' as TaskPriority],
    status:         ['todo' as TaskStatus],
    dueDate:        [''],
    dueTime:        [''],
    estimatedHours: [null as number | null],
    categoryIds:    [[] as string[]],
    tags:           ['']
  });

  ngOnInit(): void {
    const t = this.task();
    if (!t) return;
    this.editForm.patchValue({
      title:          t.title,
      description:    t.description ?? '',
      priority:       t.priority,
      status:         t.status,
      dueDate:        t.dueDate ? t.dueDate.toDate().toISOString().split('T')[0] : '',
      dueTime:        t.dueTime ?? '',
      estimatedHours: t.estimatedHours ?? null,
      categoryIds:    t.categoryIds,
      tags:           t.tags.join(', ')
    });
  }

  startEdit(): void { this.isEditing.set(true); }
  cancelEdit(): void { this.isEditing.set(false); }

  async saveEdit(): Promise<void> {
    const task = this.task();
    if (!task) return;
    this.isSaving.set(true);
    const v = this.editForm.value;

    try {
      await this.taskService.updateTask(task.id, {
        title:          v.title!,
        description:    v.description ?? '',
        priority:       v.priority as TaskPriority,
        status:         v.status as TaskStatus,
        dueDate:        v.dueDate ? Timestamp.fromDate(new Date(v.dueDate)) : null,
        dueTime:        v.dueTime || null,
        estimatedHours: v.estimatedHours ?? null,
        categoryIds:    v.categoryIds ?? [],
        tags:           v.tags ? (v.tags as string).split(',').map(t => t.trim()).filter(Boolean) : []
      });
      this.isEditing.set(false);
    } finally {
      this.isSaving.set(false);
    }
  }

  async addChecklistItem(): Promise<void> {
    const text = this.newItemText().trim();
    if (!text || !this.task()) return;
    await this.taskService.addChecklistItem(this.task()!.id, text);
    this.newItemText.set('');
  }

  async toggleChecklist(itemId: string): Promise<void> {
    const task = this.task();
    if (!task) return;
    await this.taskService.toggleChecklistItem(task.id, itemId);
  }

  async deleteTask(): Promise<void> {
    if (!confirm('Delete this task?')) return;
    await this.taskService.deleteTask(this.id());
    this.router.navigate(['/tasks']);
  }

  async autoSchedule(): Promise<void> {
    const task = this.task();
    const prefs = this.auth.userProfile()?.preferences;
    if (!task || !prefs) return;
    this.isSaving.set(true);
    try {
      await this.scheduling.autoScheduleTask(task, prefs.workingHours.start, prefs.workingHours.end);
    } finally {
      this.isSaving.set(false);
    }
  }

  priorityColor(p: TaskPriority): string {
    return { low: '#10b981', medium: '#f59e0b', high: '#f43f5e', urgent: '#ff4444' }[p] ?? '#6366f1';
  }

  trackByItem(_: number, item: ChecklistItem): string { return item.id; }
}
