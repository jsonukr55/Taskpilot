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
import { ActivityFeedComponent } from '@shared/components/activity-feed/activity-feed.component';
import { Timestamp } from '@angular/fire/firestore';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '@core/services/supabase.service';
import { toTs, fromTs } from '@core/services/supabase-map.util';
import { Insight, InsightType } from '@shared/models/schedule.model';
import { Task } from '@shared/models/task.model';
import { ActivityEvent } from '@shared/models/activity.model';

@Component({
  selector:   'tp-dashboard',
  standalone: true,
  imports:    [RouterLink, IconComponent, TooltipDirective, TaskCardComponent, TaskDrawerComponent, ActivityFeedComponent, DecimalPipe],
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
  private readonly supa      = inject(SupabaseService);

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

  private insightChannel?: RealtimeChannel;
  private insightTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.loadInsights();
    // Generate fresh insights if none exist (wait for tasks to load)
    this.insightTimer = setTimeout(() => this.maybeGenerateInsights(), 3500);
  }

  ngOnDestroy(): void {
    if (this.insightChannel) void this.supa.client.removeChannel(this.insightChannel);
    if (this.insightTimer) clearTimeout(this.insightTimer);
  }

  // ---- Focus task quick actions ----

  /** Mark the current focus task complete (optimistic-free, via listener echo). */
  completeFocus(task: Task): void {
    this.tasks.updateStatus(task.id, 'completed');
  }

  /** Open the entity behind an activity row: task → drawer; note/group → route. */
  onActivity(event: ActivityEvent): void {
    if (event.category === 'task') {
      const task = this.tasks.getTaskById(event.entityId);
      if (task) { this.selectedTask.set(task); return; }
    }
    if (event.route) this.router.navigate(event.route);
  }

  private loadInsights(): void {
    const uid = this.auth.userId();
    if (!uid) return;

    void this.fetchInsights(uid);
    this.insightChannel = this.supa.client
      .channel(`insights:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'insights', filter: `user_id=eq.${uid}` },
        () => void this.fetchInsights(uid))
      .subscribe();
  }

  private async fetchInsights(uid: string): Promise<void> {
    const { data } = await this.supa.db('insights')
      .select('*').eq('user_id', uid).eq('dismissed', false)
      .order('created_at', { ascending: false }).limit(5);
    this.insights.set((data ?? []).map(rowToInsight));
  }

  private async maybeGenerateInsights(): Promise<void> {
    if (!this.ai.enabled) return;                 // AI off → no generation
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

      // Also persist to Supabase (best-effort)
      this.supa.db('insights').insert(insightObjects.map(ins => ({
        user_id: ins.userId, type: ins.type, title: ins.title,
        body: ins.body, icon: ins.icon, severity: ins.severity,
        read: false, dismissed: false, expires_at: fromTs(expires),
      }))).then(({ error }) => { if (error) console.warn('[Insights] write failed:', error.message); });
    } finally {
      this.generatingInsights.set(false);
    }
  }

  dismissInsight(insight: Insight): void {
    this.insights.update(list => list.filter(i => i.id !== insight.id));
    // Also persist if it's a stored insight (not a temp gen_ id)
    if (!insight.id.startsWith('gen_')) {
      void this.supa.db('insights').update({ dismissed: true }).eq('id', insight.id);
    }
  }

  trackByTask(_: number, t: Task): string { return t.id; }
}

// ---- Mapping ----

function rowToInsight(r: any): Insight {
  return {
    id:        r.id,
    userId:    r.user_id,
    type:      r.type,
    title:     r.title,
    body:      r.body,
    icon:      r.icon ?? '💡',
    severity:  r.severity,
    read:      r.read,
    dismissed: r.dismissed,
    createdAt: toTs(r.created_at) as any,
    expiresAt: toTs(r.expires_at) as any,
  } as Insight;
}
