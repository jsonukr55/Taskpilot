import { Component, OnInit, inject, computed, signal } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { AuthService } from '@core/services/auth.service';
import { AiService } from '@core/services/ai.service';
import { NoteService } from '@core/services/note.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';
import { TaskCardComponent } from '@shared/components/task-card/task-card.component';
import { TaskDrawerComponent } from '@shared/components/task-drawer/task-drawer.component';
import {
  Firestore, collection, query, where, orderBy,
  limit, onSnapshot, addDoc, Timestamp
} from '@angular/fire/firestore';
import { Insight, InsightType } from '@shared/models/schedule.model';
import { Task } from '@shared/models/task.model';

@Component({
  selector:   'tp-dashboard',
  standalone: true,
  imports:    [RouterLink, IconComponent, TooltipDirective, TaskCardComponent, TaskDrawerComponent, DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl:    './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  readonly tasks      = inject(TaskService);
  readonly categories = inject(CategoryService);
  readonly auth       = inject(AuthService);
  readonly ai         = inject(AiService);
  private readonly notes     = inject(NoteService);
  private readonly router    = inject(Router);
  private readonly firestore = inject(Firestore);

  readonly creatingNote = signal(false);

  /** One-click: create a personal note and jump into it. */
  async newNote(): Promise<void> {
    if (this.creatingNote()) return;
    this.creatingNote.set(true);
    try {
      const id = await this.notes.createNote(null);
      await this.router.navigate(['/notes', id]);
    } finally {
      this.creatingNote.set(false);
    }
  }

  readonly insights           = signal<Insight[]>([]);
  readonly generatingInsights = signal(false);
  readonly selectedTask       = signal<Task | null>(null);

  // ---- Computed Stats ----
  readonly stats = computed(() => {
    const all       = this.tasks.tasks();
    const today     = this.tasks.todayTasks();
    const overdue   = this.tasks.overdueTasks();
    const completed = all.filter(t => t.status === 'completed');
    const rate      = this.tasks.completionRate();

    return { total: all.length, today: today.length, overdue: overdue.length, completed: completed.length, rate };
  });

  readonly tasksByCategory = computed(() => {
    const cats  = this.categories.rootCategories();
    const tasks = this.tasks.tasks();
    return cats.map(cat => ({
      category: cat,
      count:    tasks.filter(t => t.categoryIds.includes(cat.id)).length,
      done:     tasks.filter(t => t.categoryIds.includes(cat.id) && t.status === 'completed').length
    })).filter(r => r.count > 0);
  });

  readonly recentlyCompleted = computed(() =>
    this.tasks.tasks()
      .filter(t => t.status === 'completed' && t.completedAt)
      .sort((a, b) => (b.completedAt?.seconds ?? 0) - (a.completedAt?.seconds ?? 0))
      .slice(0, 3)
  );

  readonly upcomingTasks = computed(() =>
    this.tasks.getTasksDueInDays(7).slice(0, 5)
  );

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const name = this.auth.displayName().split(' ')[0];
    if (hour < 12) return `Good morning, ${name}`;
    if (hour < 17) return `Good afternoon, ${name}`;
    return `Good evening, ${name}`;
  });

  private insightUnsub?: () => void;

  ngOnInit(): void {
    this.loadInsights();
    // Generate fresh insights if none exist (wait for tasks to load)
    setTimeout(() => this.maybeGenerateInsights(), 3500);
  }

  private loadInsights(): void {
    const uid = this.auth.userId();
    if (!uid) return;

    const q = query(
      collection(this.firestore, 'insights'),
      where('userId', '==', uid),
      where('dismissed', '==', false),
      orderBy('createdAt', 'desc'),
      limit(5)
    );

    this.insightUnsub = onSnapshot(q, snap => {
      this.insights.set(snap.docs.map(d => ({ id: d.id, ...d.data() } as Insight)));
    });
  }

  private async maybeGenerateInsights(): Promise<void> {
    if (this.insights().length > 0) return;
    if (this.tasks.tasks().length < 3) return;

    this.generatingInsights.set(true);
    try {
      const tasks       = this.tasks.tasks();
      const categories  = this.categories.categories();
      const byCategory: Record<string, number> = {};
      const doneByCategory: Record<string, number> = {};

      categories.forEach(cat => {
        byCategory[cat.name]    = tasks.filter(t => t.categoryIds.includes(cat.id)).length;
        doneByCategory[cat.name] = tasks.filter(t => t.categoryIds.includes(cat.id) && t.status === 'completed').length;
      });

      const rates: Record<string, number> = {};
      Object.entries(byCategory).forEach(([name, total]) => {
        rates[name] = total > 0 ? Math.round((doneByCategory[name] / total) * 100) : 0;
      });

      const uid = this.auth.userId();
      if (!uid) return;

      const generated = await this.ai.generateInsights({
        tasksByCategory:   byCategory,
        completionRates:   rates,
        delayPatterns:     {},
        overdueCount:      this.tasks.overdueTasks().length,
        tomorrowTaskCount: this.tasks.getTasksDueInDays(1).length,
        streak:            this.auth.userProfile()?.stats.currentStreak ?? 0
      });

      const iconMap: Record<string, string> = {
        overbooked:        '🔥',
        delay_pattern:     '⏰',
        completion_trend:  '📈',
        workload_warning:  '⚠️',
        category_imbalance:'📊',
        missed_tasks:      '❌',
        focus_time:        '🎯',
        peak_productivity: '⚡',
      };
      const now     = Timestamp.now();
      const expires = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Map to Insight objects and set signal immediately (don't wait for Firestore)
      const insightObjects: Insight[] = generated.map((ins, i) => ({
        id:        `gen_${i}_${Date.now()}`,
        userId:    uid,
        type:      (ins.type ?? 'completion_trend') as InsightType,
        title:     ins.title,
        body:      ins.body,
        icon:      iconMap[ins.type] ?? '💡',
        severity:  (ins.severity ?? 'info') as Insight['severity'],
        read:      false,
        dismissed: false,
        createdAt: now,
        expiresAt: expires,
      }));
      this.insights.set(insightObjects);

      // Also persist to Firestore (best-effort)
      Promise.all(insightObjects.map(ins =>
        addDoc(collection(this.firestore, 'insights'), {
          userId: ins.userId, type: ins.type, title: ins.title,
          body: ins.body, icon: ins.icon, severity: ins.severity,
          read: false, dismissed: false, createdAt: now, expiresAt: expires,
        })
      )).catch(err => console.warn('[Insights] Firestore write failed:', err));
    } finally {
      this.generatingInsights.set(false);
    }
  }

  dismissInsight(insight: Insight): void {
    this.insights.update(list => list.filter(i => i.id !== insight.id));
    // Also update Firestore if it's a persisted insight (not a temp gen_ id)
    if (!insight.id.startsWith('gen_')) {
      import('@angular/fire/firestore').then(({ doc, updateDoc }) => {
        updateDoc(doc(this.firestore, 'insights', insight.id), { dismissed: true });
      });
    }
  }

  trackByTask(_: number, t: Task): string { return t.id; }
}
