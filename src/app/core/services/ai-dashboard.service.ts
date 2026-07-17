import { Injectable, inject, computed, Signal } from '@angular/core';
import { environment } from '@env/environment';
import { AiService } from './ai.service';
import { TaskService } from './task.service';
import { DashboardService } from './dashboard.service';
import { AuthService } from './auth.service';
import { Task } from '@shared/models/task.model';
import { AiBrief, AiBriefKind, RiskFlag } from '@shared/models/ai-brief.model';

// ============================================================
// AiDashboardService
// ------------------------------------------------------------
// Reusable AI methods for the dashboard: Morning Brief, Daily
// Summary, Weekly Summary, Productivity Suggestions, Focus
// Recommendation, and Risk Detection.
//
// Design principles:
//  • Reuse the EXISTING AI infrastructure only. Every brief is
//    produced through `AiService.transformText` (the generic writing
//    endpoint). No new Cloud Functions / APIs are introduced.
//  • Derive all facts from existing signals (DashboardService /
//    TaskService / AuthService) — no new Firestore listeners.
//  • Always degrade gracefully: each brief has a deterministic local
//    generator that runs when AI is unavailable or errors, so callers
//    always receive usable content.
//  • Avoid repeated queries: results are cached per-kind with a short
//    TTL and in-flight calls are de-duplicated.
// ============================================================

const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const STALE_WIP_DAYS = 3;

/** Immutable, deterministic snapshot of the user's current workload. */
interface WorkloadSnapshot {
  dateLabel:        string;
  total:            number;
  open:             number;
  overdue:          number;
  dueToday:         number;
  dueTomorrow:      number;
  dueThisWeek:      number;
  inProgress:       number;
  completedToday:   number;
  completedThisWeek: number;
  completionRate:   number;
  score:            number;
  scoreLabel:       string;
  streak:           number;
  topTasks:         Task[];
  focusTitle:       string | null;
  focusReason:      string | null;
  weekTrendPercent: number;
  categoryLines:    string[];
}

@Injectable({ providedIn: 'root' })
export class AiDashboardService {
  private readonly ai    = inject(AiService);
  private readonly tasks = inject(TaskService);
  private readonly dash  = inject(DashboardService);
  private readonly auth  = inject(AuthService);

  private readonly aiEnabled = !!environment.functionsBaseUrl;

  private readonly cache    = new Map<AiBriefKind, AiBrief>();
  private readonly inflight = new Map<AiBriefKind, Promise<AiBrief>>();

  // ---- Public brief methods -------------------------------------------

  /** A short, upbeat start-of-day overview. */
  morningBrief(opts?: { force?: boolean }): Promise<AiBrief> {
    return this.generate('morning', opts);
  }

  /** An end-of-day recap of what got done and what's left. */
  dailySummary(opts?: { force?: boolean }): Promise<AiBrief> {
    return this.generate('daily', opts);
  }

  /** A reflective summary of the past 7 days. */
  weeklySummary(opts?: { force?: boolean }): Promise<AiBrief> {
    return this.generate('weekly', opts);
  }

  /** 2–4 concrete, actionable productivity suggestions. */
  productivitySuggestions(opts?: { force?: boolean }): Promise<AiBrief> {
    return this.generate('suggestions', opts);
  }

  /** Advice on the single best thing to work on next. */
  focusRecommendation(opts?: { force?: boolean }): Promise<AiBrief> {
    return this.generate('focus', opts);
  }

  /** A narrative of the biggest risks to the user's plan. */
  riskDetection(opts?: { force?: boolean }): Promise<AiBrief> {
    return this.generate('risk', opts);
  }

  // ---- Structured risk flags (deterministic, no AI needed) ------------

  /**
   * Reusable, always-available structured risks derived purely from the
   * task signals. Cheap enough to read directly in templates; also used
   * as the factual basis for the AI `riskDetection()` narrative.
   */
  readonly riskFlags: Signal<RiskFlag[]> = computed(() => {
    const flags: RiskFlag[] = [];
    const s   = this.dash.stats();
    const now = Date.now();

    if (s.overdue > 0) {
      const ids = this.tasks.overdueTasks().map(t => t.id);
      flags.push({
        id: 'overdue',
        severity: s.overdue >= 5 ? 'critical' : 'warning',
        title: `${s.overdue} overdue ${this.plural(s.overdue, 'task')}`,
        detail: 'These are past their due date and still open.',
        taskIds: ids,
      });
    }

    const openToday = this.tasks.todayTasks().filter(t => this.isOpen(t));
    if (openToday.length >= 5) {
      flags.push({
        id: 'today-overload',
        severity: 'warning',
        title: `Heavy day: ${openToday.length} tasks due today`,
        detail: 'Consider deferring lower-priority items to protect focus.',
        taskIds: openToday.map(t => t.id),
      });
    }

    const staleWip = this.tasks.tasks().filter(t =>
      t.status === 'in_progress' &&
      t.updatedAt && now - t.updatedAt.toMillis() > STALE_WIP_DAYS * DAY_MS
    );
    if (staleWip.length > 0) {
      flags.push({
        id: 'stale-wip',
        severity: 'warning',
        title: `${staleWip.length} stalled in-progress ${this.plural(staleWip.length, 'task')}`,
        detail: `No updates in over ${STALE_WIP_DAYS} days — finish or re-plan them.`,
        taskIds: staleWip.map(t => t.id),
      });
    }

    const urgentUndated = this.tasks.tasks().filter(t =>
      this.isOpen(t) && (t.priority === 'urgent' || t.priority === 'high') && !t.dueDate
    );
    if (urgentUndated.length >= 2) {
      flags.push({
        id: 'urgent-undated',
        severity: 'warning',
        title: `${urgentUndated.length} high-priority tasks without a due date`,
        detail: 'Add deadlines so they get scheduled before they slip.',
        taskIds: urgentUndated.map(t => t.id),
      });
    }

    return flags;
  });

  /** Clear cached briefs (e.g. after a large bulk edit). */
  invalidate(kind?: AiBriefKind): void {
    if (kind) this.cache.delete(kind);
    else this.cache.clear();
  }

  // ---- Generation core ------------------------------------------------

  private async generate(kind: AiBriefKind, opts?: { force?: boolean }): Promise<AiBrief> {
    const force = opts?.force ?? false;

    const cached = this.cache.get(kind);
    if (!force && cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
      return cached;
    }

    const existing = this.inflight.get(kind);
    if (existing && !force) return existing;

    const run = this.run(kind).finally(() => this.inflight.delete(kind));
    this.inflight.set(kind, run);
    return run;
  }

  private async run(kind: AiBriefKind): Promise<AiBrief> {
    const snap  = this.snapshot();
    const local = this.buildLocal(kind, snap);

    let brief: AiBrief = local;
    if (this.aiEnabled) {
      try {
        const text = await this.ai.transformText(this.instruction(kind), this.facts(snap));
        const clean = (text ?? '').trim();
        if (clean.length >= 8) {
          brief = { ...local, text: clean, bullets: this.toBullets(clean), source: 'ai' };
        }
      } catch (err) {
        console.warn(`[AiDashboard] ${kind} fell back to local generation:`, err);
      }
    }

    brief = { ...brief, generatedAt: Date.now() };
    this.cache.set(kind, brief);
    return brief;
  }

  // ---- Snapshot (deterministic facts) ---------------------------------

  private snapshot(): WorkloadSnapshot {
    const all   = this.tasks.tasks();
    const s     = this.dash.stats();
    const score = this.dash.productivityScore();
    const week  = this.dash.weeklyProductivity();

    const now       = Date.now();
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const startMs   = startToday.getTime();

    const completedToday = all.filter(t =>
      t.status === 'completed' && t.completedAt && t.completedAt.toMillis() >= startMs
    ).length;

    const open = all.filter(t => this.isOpen(t));

    // The most important open tasks (reuse the same ordering as the focus card).
    const topTasks = [...open]
      .sort((a, b) => this.urgency(a, now) - this.urgency(b, now))
      .slice(0, 5);

    const focus = this.dash.focusTask();

    return {
      dateLabel:        new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      total:            s.total,
      open:             open.length,
      overdue:          s.overdue,
      dueToday:         s.today,
      dueTomorrow:      this.tasks.getTasksDueInDays(1).length,
      dueThisWeek:      this.dash.upcomingDeadlines().length,
      inProgress:       s.inProgress,
      completedToday,
      completedThisWeek: week.completedThisWeek,
      completionRate:   s.rate,
      score:            score.value,
      scoreLabel:       score.label,
      streak:           this.auth.userProfile()?.stats?.currentStreak ?? 0,
      topTasks,
      focusTitle:       focus?.task.title ?? null,
      focusReason:      focus?.reason ?? null,
      weekTrendPercent: week.trendPercent,
      categoryLines:    this.dash.categoryProgress()
                          .slice(0, 5)
                          .map(c => `${c.category.name}: ${c.done}/${c.count} done (${c.percent}%)`),
    };
  }

  /** Deterministic fact sheet fed to the AI as the "text" to transform. */
  private facts(s: WorkloadSnapshot): string {
    const lines = [
      `Today is ${s.dateLabel}.`,
      `Tasks: ${s.total} total, ${s.open} open, ${s.overdue} overdue, ${s.dueToday} due today, ${s.dueTomorrow} due tomorrow, ${s.inProgress} in progress.`,
      `Completed: ${s.completedToday} today, ${s.completedThisWeek} this week. Completion rate ${s.completionRate}%.`,
      `Productivity score ${s.score}/100 (${s.scoreLabel}). Current streak ${s.streak} day(s). Week trend ${s.weekTrendPercent >= 0 ? '+' : ''}${s.weekTrendPercent}%.`,
    ];
    if (s.focusTitle) lines.push(`Suggested focus task: "${s.focusTitle}" (${s.focusReason}).`);
    if (s.topTasks.length) {
      lines.push('Top open tasks:');
      s.topTasks.forEach(t => lines.push(`- ${t.title} [${t.priority}${t.dueDate ? `, due ${t.dueDate.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}]`));
    }
    if (s.categoryLines.length) {
      lines.push('By category:');
      s.categoryLines.forEach(l => lines.push(`- ${l}`));
    }
    return lines.join('\n');
  }

  // ---- AI instructions per kind ---------------------------------------

  private instruction(kind: AiBriefKind): string {
    const base = 'You are a concise, encouraging productivity coach. Using ONLY the facts provided, write in plain text (no markdown headings, no code fences). Refer to the user as "you".';
    switch (kind) {
      case 'morning':
        return `${base} Write a brief 2-3 sentence MORNING BRIEF that sets up the day: what matters most, how many items are due, and one motivating nudge. Be specific with the numbers given.`;
      case 'daily':
        return `${base} Write a 2-3 sentence END-OF-DAY SUMMARY: acknowledge what was completed today, note what remains, and end on a forward-looking note.`;
      case 'weekly':
        return `${base} Write a 3-4 sentence WEEKLY SUMMARY reflecting on the past 7 days: throughput, the trend vs last week, and one theme to carry forward.`;
      case 'suggestions':
        return `${base} Provide 3-4 concrete PRODUCTIVITY SUGGESTIONS as short bullet lines, each starting with "- ". Base each suggestion strictly on the facts (overdue count, in-progress load, due dates, category imbalance).`;
      case 'focus':
        return `${base} Recommend the SINGLE best thing to focus on right now and why, in 2 sentences. If a suggested focus task is given, center the advice on it.`;
      case 'risk':
        return `${base} Identify the top RISKS to the user's plan (overdue clusters, overloaded days, stalled work, missing deadlines) as short bullet lines starting with "- ". If nothing is at risk, say so in one line.`;
    }
  }

  // ---- Deterministic local fallbacks ----------------------------------

  private buildLocal(kind: AiBriefKind, s: WorkloadSnapshot): AiBrief {
    const base = { kind, source: 'local' as const, generatedAt: Date.now() };
    switch (kind) {
      case 'morning':     return { ...base, title: 'Morning Brief',            ...this.localMorning(s) };
      case 'daily':       return { ...base, title: 'Daily Summary',            ...this.localDaily(s) };
      case 'weekly':      return { ...base, title: 'Weekly Summary',           ...this.localWeekly(s) };
      case 'suggestions': return { ...base, title: 'Productivity Suggestions', ...this.localSuggestions(s) };
      case 'focus':       return { ...base, title: 'Focus Recommendation',     ...this.localFocus(s) };
      case 'risk':        return { ...base, title: 'Risk Detection',           ...this.localRisk(s) };
    }
  }

  private localMorning(s: WorkloadSnapshot): { text: string; bullets: string[] } {
    const parts: string[] = [`Good morning — it's ${s.dateLabel}.`];
    if (s.overdue > 0)       parts.push(`You have ${s.overdue} overdue ${this.plural(s.overdue, 'task')} to clear first.`);
    if (s.dueToday > 0)      parts.push(`${s.dueToday} ${this.plural(s.dueToday, 'task')} due today.`);
    else if (s.overdue === 0) parts.push(`Nothing due today — a good day to get ahead.`);
    if (s.focusTitle)        parts.push(`Start with "${s.focusTitle}" (${s.focusReason}).`);
    if (s.streak >= 3)       parts.push(`Keep your ${s.streak}-day streak alive! 🔥`);
    return { text: parts.join(' '), bullets: [] };
  }

  private localDaily(s: WorkloadSnapshot): { text: string; bullets: string[] } {
    const parts: string[] = [];
    parts.push(s.completedToday > 0
      ? `You completed ${s.completedToday} ${this.plural(s.completedToday, 'task')} today — nice work.`
      : `No tasks completed yet today.`);
    if (s.open > 0)     parts.push(`${s.open} ${this.plural(s.open, 'task')} still open${s.overdue > 0 ? `, ${s.overdue} overdue` : ''}.`);
    if (s.dueTomorrow > 0) parts.push(`${s.dueTomorrow} due tomorrow — plan ahead tonight.`);
    parts.push(`Completion rate sits at ${s.completionRate}%.`);
    return { text: parts.join(' '), bullets: [] };
  }

  private localWeekly(s: WorkloadSnapshot): { text: string; bullets: string[] } {
    const trend = s.weekTrendPercent > 0 ? `up ${s.weekTrendPercent}% vs last week`
                : s.weekTrendPercent < 0 ? `down ${-s.weekTrendPercent}% vs last week`
                : `steady vs last week`;
    const parts = [
      `Over the last 7 days you completed ${s.completedThisWeek} ${this.plural(s.completedThisWeek, 'task')} (${trend}).`,
      `Your productivity score is ${s.score}/100 (${s.scoreLabel}).`,
    ];
    if (s.overdue > 0) parts.push(`Watch the ${s.overdue} overdue ${this.plural(s.overdue, 'task')} carrying into next week.`);
    else parts.push(`No overdue tasks — a clean slate going forward.`);
    return { text: parts.join(' '), bullets: [] };
  }

  private localSuggestions(s: WorkloadSnapshot): { text: string; bullets: string[] } {
    const bullets: string[] = [];
    if (s.overdue > 0)      bullets.push(`Clear ${s.overdue} overdue ${this.plural(s.overdue, 'task')} before starting new work.`);
    if (s.inProgress >= 3)  bullets.push(`Finish some of your ${s.inProgress} in-progress tasks to reduce context-switching.`);
    if (s.dueToday > 0)     bullets.push(`Time-box your ${s.dueToday} due-today ${this.plural(s.dueToday, 'task')} this morning.`);
    if (s.focusTitle)       bullets.push(`Begin with "${s.focusTitle}" — it's your highest-impact item.`);
    if (bullets.length < 2) bullets.push(`Plan tomorrow tonight so you start with momentum.`);
    return { text: bullets.map(b => `- ${b}`).join('\n'), bullets };
  }

  private localFocus(s: WorkloadSnapshot): { text: string; bullets: string[] } {
    const text = s.focusTitle
      ? `Focus on "${s.focusTitle}" next — ${s.focusReason}. Give it an uninterrupted block before moving on.`
      : (s.open > 0
          ? `You have ${s.open} open ${this.plural(s.open, 'task')} but none stand out — pick the one that unblocks the most and start there.`
          : `You're all caught up. Use this time to plan ahead or get ahead on upcoming work.`);
    return { text, bullets: [] };
  }

  private localRisk(s: WorkloadSnapshot): { text: string; bullets: string[] } {
    const bullets = this.riskFlags().map(f => `${f.title} — ${f.detail}`);
    if (!bullets.length) {
      return { text: 'No significant risks detected. Your workload looks balanced.', bullets: [] };
    }
    return { text: bullets.map(b => `- ${b}`).join('\n'), bullets };
  }

  // ---- Helpers --------------------------------------------------------

  private isOpen(t: Task): boolean {
    return t.status !== 'completed' && t.status !== 'cancelled';
  }

  private plural(n: number, word: string): string {
    return n === 1 ? word : `${word}s`;
  }

  /** Same urgency ordering used by the focus card (lower = more urgent). */
  private urgency(t: Task, now: number): number {
    const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const due = t.dueDate ? t.dueDate.toMillis() : Infinity;
    let group = 2;
    if (due < now) group = 0;
    else if (due < now + DAY_MS) group = 1;
    return group * 1e15 + rank[t.priority] * 1e12 + (due === Infinity ? 0.999e12 : due);
  }

  /** Split AI text into bullet points (lines starting with -, •, or *). */
  private toBullets(text: string): string[] {
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => /^[-•*]\s+/.test(l))
      .map(l => l.replace(/^[-•*]\s+/, '').trim())
      .filter(Boolean);
  }
}
