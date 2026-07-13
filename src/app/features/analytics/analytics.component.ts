import { Component, inject, computed } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '@shared/components/icon/icon.component';

@Component({
  selector:   'tp-analytics',
  standalone: true,
  imports:    [DecimalPipe, DatePipe, RouterLink, IconComponent],
  templateUrl: './analytics.component.html',
  styleUrl:    './analytics.component.scss'
})
export class AnalyticsComponent {
  readonly tasks      = inject(TaskService);
  readonly categories = inject(CategoryService);
  readonly auth       = inject(AuthService);

  readonly completionRate = computed(() => this.tasks.completionRate());

  readonly categoryStats = computed(() =>
    this.categories.rootCategories().map(cat => {
      const catTasks = this.tasks.getTasksByCategory(cat.id);
      const done     = catTasks.filter(t => t.status === 'completed').length;
      const overdue  = catTasks.filter(t =>
        t.dueDate && t.dueDate.toDate() < new Date() && t.status !== 'completed'
      ).length;
      const totalHours = catTasks.reduce((sum, t) => sum + (t.actualHours ?? t.estimatedHours ?? 0), 0);

      return {
        category:    cat,
        total:       catTasks.length,
        done,
        overdue,
        totalHours,
        rate: catTasks.length > 0 ? Math.round((done / catTasks.length) * 100) : 0
      };
    }).filter(s => s.total > 0)
  );

  readonly priorityBreakdown = computed(() => {
    const tasks = this.tasks.tasks();
    return [
      { label: 'Urgent', value: tasks.filter(t => t.priority === 'urgent').length, color: '#ff4444' },
      { label: 'High',   value: tasks.filter(t => t.priority === 'high').length,   color: '#f43f5e' },
      { label: 'Medium', value: tasks.filter(t => t.priority === 'medium').length, color: '#f59e0b' },
      { label: 'Low',    value: tasks.filter(t => t.priority === 'low').length,    color: '#10b981' }
    ].filter(p => p.value > 0);
  });

  readonly weeklyData = computed(() => {
    const days: { date: Date; label: string; count: number; done: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end   = new Date(start.getTime() + 86_400_000);

      const dayTasks = this.tasks.tasks().filter(t => {
        const created = t.createdAt.toDate();
        return created >= start && created < end;
      });

      days.push({
        date:  d,
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        count: dayTasks.length,
        done:  dayTasks.filter(t => t.status === 'completed').length
      });
    }
    return days;
  });

  readonly maxWeeklyCount = computed(() =>
    Math.max(...this.weeklyData().map(d => d.count), 1)
  );

  readonly totalHoursEstimated = computed(() =>
    this.tasks.tasks().reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0)
  );

  readonly aiCreatedTasks = computed(() =>
    this.tasks.tasks().filter(t => t.aiMetadata && t.aiMetadata.extractionMethod !== 'manual').length
  );
}
