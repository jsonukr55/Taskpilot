import { Injectable, inject } from '@angular/core';
import { environment } from '@env/environment';
import { AiService } from './ai.service';
import { ReportView, ReportRow } from '@shared/models/daily-report.model';

// ============================================================
// ReportSummaryService
// ------------------------------------------------------------
// Generates three kinds of daily-report summary — Professional,
// Manager, and Teams — from a ReportView. Reuses the existing
// `transformText` AI endpoint (no new API) and ALWAYS falls back to a
// deterministic local summary when AI is unavailable or errors, so a
// summary is always produced.
// ============================================================

export type ReportSummaryKind = 'professional' | 'manager' | 'teams';

export interface ReportSummaryMeta {
  submitted: number;
  total:     number;
}

export interface ReportSummaryResult {
  kind:   ReportSummaryKind;
  text:   string;
  source: 'ai' | 'local';
}

const BLOCKER_WORDS = ['block', 'blocked', 'blocker', 'wait', 'waiting', 'delay', 'delayed', 'stuck', 'issue', 'depend'];

@Injectable({ providedIn: 'root' })
export class ReportSummaryService {
  private readonly ai = inject(AiService);
  private readonly aiEnabled = !!environment.functionsBaseUrl;

  async summarize(kind: ReportSummaryKind, view: ReportView, meta: ReportSummaryMeta): Promise<ReportSummaryResult> {
    const local: ReportSummaryResult = { kind, source: 'local', text: this.localSummary(kind, view, meta) };
    if (!this.aiEnabled) return local;

    try {
      const out = (await this.ai.transformText(this.instruction(kind), this.facts(view, meta))).trim();
      if (out.length >= 8) return { kind, source: 'ai', text: out };
    } catch (e) {
      console.warn(`[ReportSummary] ${kind} fell back to local:`, e);
    }
    return local;
  }

  // ---- AI inputs ------------------------------------------------------

  private instruction(kind: ReportSummaryKind): string {
    const base = 'You are summarizing a team\'s daily stand-up report. Use ONLY the facts provided. Plain text, no markdown headings, no code fences.';
    switch (kind) {
      case 'professional':
        return `${base} Write a concise, professional status summary (3-5 sentences, neutral third person) covering what the team accomplished and what's planned next. Call out any blockers or risks.`;
      case 'manager':
        return `${base} Write a manager-focused briefing as short bullet lines each starting with "- ": overall completion (use the submitted/total figure), key deliverables done, what's planned, and explicitly a "Blockers:" line listing anything blocked/waiting/delayed (or "none").`;
      case 'teams':
        return `${base} Write a short, skimmable Microsoft Teams status message (2-4 sentences, light emoji allowed) summarizing today's progress and tomorrow's plan. Friendly but concise.`;
    }
  }

  private facts(view: ReportView, meta: ReportSummaryMeta): string {
    const lines: string[] = [
      `Date: ${view.dateHeader}`,
      `Submitted: ${meta.submitted}/${meta.total} members.`,
      'Progress today:',
      ...this.rowsToLines(view.progress),
      'Plan for next working day:',
      ...this.rowsToLines(view.plan),
    ];
    return lines.join('\n');
  }

  private rowsToLines(rows: ReportRow[]): string[] {
    if (!rows.length) return ['- (nothing submitted)'];
    return rows.map(r => r.onLeave
      ? `- ${r.displayName}: on leave`
      : `- ${r.displayName}: ${r.lines.join('; ')}`);
  }

  // ---- Deterministic local fallbacks ----------------------------------

  private localSummary(kind: ReportSummaryKind, view: ReportView, meta: ReportSummaryMeta): string {
    const progressItems = this.countLines(view.progress);
    const planItems      = this.countLines(view.plan);
    const activePeople   = view.progress.filter(r => !r.onLeave && r.lines.length).length;
    const onLeave        = view.progress.filter(r => r.onLeave).map(r => r.displayName);
    const blockers       = this.blockers(view);

    switch (kind) {
      case 'professional': {
        const parts = [
          `On ${view.dateHeader}, the team completed ${progressItems} update${plural(progressItems)} across ${activePeople} member${plural(activePeople)}, with ${planItems} item${plural(planItems)} planned for the next working day.`,
        ];
        if (blockers.length) parts.push(`Blockers to resolve: ${blockers.join('; ')}.`);
        if (onLeave.length)  parts.push(`On leave: ${onLeave.join(', ')}.`);
        return parts.join(' ');
      }
      case 'manager': {
        const b = [
          `- ${meta.submitted}/${meta.total} members submitted`,
          `- ${progressItems} progress item${plural(progressItems)} completed`,
          `- ${planItems} item${plural(planItems)} planned next`,
          `- Blockers: ${blockers.length ? blockers.join('; ') : 'none'}`,
        ];
        if (onLeave.length) b.push(`- On leave: ${onLeave.join(', ')}`);
        return b.join('\n');
      }
      case 'teams':
        return `📋 Daily update — ${view.dateHeader}: ${progressItems} done ✅, ${planItems} planned for next 📅`
          + (blockers.length ? `, ${blockers.length} blocker${plural(blockers.length)} ⚠️` : '')
          + `. ${meta.submitted}/${meta.total} submitted.`;
    }
  }

  private countLines(rows: ReportRow[]): number {
    return rows.reduce((n, r) => n + (r.onLeave ? 0 : r.lines.length), 0);
  }

  /** Report lines that look like blockers (keyword match). */
  private blockers(view: ReportView): string[] {
    const out: string[] = [];
    for (const r of [...view.progress, ...view.plan]) {
      if (r.onLeave) continue;
      for (const l of r.lines) {
        if (BLOCKER_WORDS.some(w => l.toLowerCase().includes(w))) out.push(l.replace(/^🚧\s*/, ''));
      }
    }
    return [...new Set(out)];
  }
}

function plural(n: number): string { return n === 1 ? '' : 's'; }
