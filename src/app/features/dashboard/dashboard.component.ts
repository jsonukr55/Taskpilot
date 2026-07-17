import { Component, OnInit, OnDestroy, inject, computed, signal } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { AuthService } from '@core/services/auth.service';
import { AiService } from '@core/services/ai.service';
import { NoteService } from '@core/services/note.service';
import { DashboardService } from '@core/services/dashboard.service';
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
import { ActivityEvent } from '@shared/models/dashboard.model';

@Component({
  selector:   'tp-dashboard',
  standalone: true,
  imports:    [RouterLink, IconComponent, TooltipDirective, TaskCardComponent, TaskDrawerComponent, DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl:    './dashboard.component.scss'
})
export class DashboardComponent implements OnInit, OnDestroy {
  readonly tasks      = inject(TaskService);
  readonly categories = inject(CategoryService);
  readonly auth       = inject(AuthService);
  readonly ai         = inject(AiService);
  readonly dash       = inject(DashboardService);
  private readonly notes     = inject(NoteService);
  private readonly router    = inject(Router);
  private readonly firestore = inject(Firestore);

  // ---- Reusable dashboard signals (all derived in DashboardService) ----
  readonly stats             = this.dash.stats;
  readonly focusTask         = this.dash.focusTask;
  readonly productivityScore = this.dash.productivityScore;
  readonly weekly            = this.dash.weeklyProductivity;
  readonly categoryProgress  = this.dash.categoryProgress;
  readonly upcomingTasks     = this.dash.upcomingDeadlines;
  readonly recentlyCompleted = this.dash.recentlyCompleted;
  readonly recentActivity    = this.dash.recentActivity;
  readonly recommendations   = this.dash.recommendations;

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

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const name = this.auth.displayName().split(' ')[0];
    if (hour < 12) return `Good morning, ${name}`;
    if (hour < 17) return `Good afternoon, ${name}`;
    return `Good evening, ${name}`;
  });

  /** Circumference of the productivity ring (r=26) for the SVG dash math. */
  readonly ringCircumference = 2 * Math.PI * 26;

  private insightUnsub?: () => void;
  private insightTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.loadInsights();
    // Generate fresh insights if none exist (wait for tasks to load)
    this.insightTimer = setTimeout(() => this.maybeGenerateInsights(), 3500);
  }

  ngOnDestroy(): void {
    this.insightUnsub?.();
    if (this.insightTimer) clearTimeout(this.insightTimer);
  }

  // ---- Focus task quick actions ----

  /** Mark the current focus task complete (optimistic-free, via listener echo). */
  completeFocus(task: Task): void {
    this.tasks.updateStatus(task.id, 'completed');
  }

  /** Short "x ago" / "in x" label for activity + relative times. */
  timeAgo(ts?: Timestamp | null): string {
    if (!ts) return '';
    const diffMs = Date.now() - ts.toMillis();
    const abs    = Math.abs(diffMs);
    const min    = Math.round(abs / 60_000);
    const suffix = diffMs >= 0 ? 'ago' : 'from now';
    if (min < 1)  return 'just now';
    if (min < 60) return `${min}m ${suffix}`;
    const hr = Math.round(min / 60);
    if (hr < 24)  return `${hr}h ${suffix}`;
    const days = Math.round(hr / 24);
    if (days < 7) return `${days}d ${suffix}`;
    return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  trackByActivity = (_: number, e: ActivityEvent): string => e.id;

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
