import { Injectable, inject, signal, computed } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { WorkingCalendarService } from './working-calendar.service';
import { Group } from '@shared/models/group.model';
import {
  DailyReport, DailyEntry, ReportLine, ReportView,
  buildReportView, reportViewToText, reportViewToHtml
} from '@shared/models/daily-report.model';
import { toTs, nowIso } from './supabase-map.util';

// ============================================================
// DailyReportService — one team's report for the current working day
// (Supabase). Report id stays deterministic (`${groupId}_${date}`), so
// history lookups by id still work. Report + entries stream via realtime.
// ============================================================

@Injectable({ providedIn: 'root' })
export class DailyReportService {
  private readonly supa     = inject(SupabaseService);
  private readonly auth     = inject(AuthService);
  private readonly calendar = inject(WorkingCalendarService);

  // ---- State ----
  readonly groupId   = signal<string | null>(null);
  readonly date      = signal<string>(this.calendar.currentWorkingDay());
  readonly report    = signal<DailyReport | null>(null);
  readonly entries   = signal<DailyEntry[]>([]);
  readonly isLoading = signal(true);

  // ---- Derived ----
  readonly isLocked = computed(() => this.report()?.status === 'locked');

  readonly myEntry = computed(() =>
    this.entries().find(e => e.userId === this.auth.userId()) ?? null
  );

  readonly planForDate = computed(() =>
    this.report()?.planForDate ?? this.calendar.nextWorkingDay(this.date())
  );

  readonly dateHeader     = computed(() => this.calendar.formatHeader(this.date()));
  readonly planDateHeader = computed(() => this.calendar.formatHeader(this.planForDate()));

  /** Structured report — drives both the pretty preview and the copied text. */
  readonly reportView = computed<ReportView>(() => buildReportView({
    dateHeader: this.dateHeader(),
    entries:    this.entries(),
    order:      this.report()?.memberOrder ?? this.entries().map(e => e.userId)
  }));

  /** Exact Teams-paste text, kept live from the entries. */
  readonly reportText = computed(() => reportViewToText(this.reportView()));

  /** Rich HTML for the clipboard — pastes into Teams as formatted text. */
  readonly reportHtml = computed(() => reportViewToHtml(this.reportView()));

  private channel?: RealtimeChannel;

  // ---- Lifecycle ----

  /** Point the service at a group's report for today (IST). */
  startListening(groupId: string): void {
    this.stopListening();
    this.groupId.set(groupId);
    this.isLoading.set(true);

    const date = this.calendar.currentWorkingDay();
    this.date.set(date);
    const reportId = this.reportId(groupId, date);

    void this.loadReport(reportId);
    void this.loadEntries(reportId);
    this.channel = this.supa.client
      .channel(`daily:${reportId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_reports', filter: `id=eq.${reportId}` },
        () => void this.loadReport(reportId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_entries', filter: `report_id=eq.${reportId}` },
        () => void this.loadEntries(reportId))
      .subscribe();
  }

  stopListening(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
    this.report.set(null);
    this.entries.set([]);
  }

  private async loadReport(reportId: string): Promise<void> {
    const { data } = await this.supa.db('daily_reports').select('*').eq('id', reportId).maybeSingle();
    this.report.set(data ? rowToReport(data) : null);
    this.isLoading.set(false);
  }

  private async loadEntries(reportId: string): Promise<void> {
    const { data } = await this.supa.db('daily_entries').select('*').eq('report_id', reportId);
    this.entries.set((data ?? []).map(rowToEntry));
  }

  // ---- Writes ----

  /** Create the parent report row if it doesn't exist yet (idempotent). */
  private async ensureReport(group: Group): Promise<string> {
    const date = this.date();
    const reportId = this.reportId(group.id, date);
    if (this.report()) return reportId;

    await this.supa.db('daily_reports').upsert({
      id:            reportId,
      group_id:      group.id,
      date,
      plan_for_date: this.calendar.nextWorkingDay(date),
      status:        'draft',
      locked_by:     null,
      locked_at:     null,
      member_order:  group.memberIds,
    }, { onConflict: 'id', ignoreDuplicates: true });

    return reportId;
  }

  /** Save the current user's own entry (progress/plan/on-leave/submitted). */
  async saveMyEntry(group: Group, data: {
    progress: ReportLine[];
    plan:     ReportLine[];
    onLeave:  boolean;
    submitted: boolean;
    displayName?: string;
  }): Promise<void> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');
    if (this.isLocked()) throw new Error('This report is locked.');

    const reportId = await this.ensureReport(group);
    await this.supa.db('daily_entries').upsert({
      report_id:    reportId,
      user_id:      uid,
      display_name: (data.displayName?.trim()) || this.auth.displayName() || 'Member',
      photo_url:    this.auth.photoURL() ?? null,
      progress:     data.progress,
      plan:         data.plan,
      on_leave:     data.onLeave,
      submitted:    data.submitted,
    }, { onConflict: 'report_id,user_id' });
  }

  /** Manager: flag a member on leave (or clear it). Writes that member's entry. */
  async setMemberLeave(group: Group, uid: string, onLeave: boolean, displayName: string): Promise<void> {
    if (this.isLocked()) throw new Error('This report is locked.');
    const reportId = await this.ensureReport(group);
    const existing = this.entries().find(e => e.userId === uid);
    await this.supa.db('daily_entries').upsert({
      report_id:    reportId,
      user_id:      uid,
      display_name: displayName,
      photo_url:    existing?.photoURL ?? null,
      on_leave:     onLeave,
      submitted:    onLeave,          // on-leave counts as "accounted for"
      progress:     onLeave ? [] : (existing?.progress ?? []),
      plan:         onLeave ? [] : (existing?.plan ?? []),
    }, { onConflict: 'report_id,user_id' });
  }

  /** Manager: edit any member's entry (progress/plan/name/on-leave). */
  async saveMemberEntry(group: Group, uid: string, data: {
    progress: ReportLine[];
    plan:     ReportLine[];
    onLeave:  boolean;
    displayName: string;
  }): Promise<void> {
    if (this.isLocked()) throw new Error('This report is locked.');
    const reportId = await this.ensureReport(group);
    const existing = this.entries().find(e => e.userId === uid);
    await this.supa.db('daily_entries').upsert({
      report_id:    reportId,
      user_id:      uid,
      display_name: data.displayName.trim() || existing?.displayName || 'Member',
      photo_url:    existing?.photoURL ?? null,
      progress:     data.onLeave ? [] : data.progress,
      plan:         data.onLeave ? [] : data.plan,
      on_leave:     data.onLeave,
      submitted:    data.onLeave ? true : (existing?.submitted ?? false),
    }, { onConflict: 'report_id,user_id' });
  }

  /** Link the group note this report is mirrored into. Creates the report row if needed. */
  async setReportNote(group: Group, noteId: string): Promise<void> {
    const reportId = await this.ensureReport(group);
    await this.supa.db('daily_reports').update({ note_id: noteId }).eq('id', reportId);
  }

  /** Manager: finalize the report — read-only from here. */
  async lock(): Promise<void> {
    const groupId = this.groupId();
    if (!groupId) return;
    await this.supa.db('daily_reports').update({
      status:    'locked',
      locked_by: this.auth.userId(),
      locked_at: nowIso(),
    }).eq('id', this.reportId(groupId, this.date()));
  }

  /** Carry-over: the current user's Plan lines from the previous working day's report. */
  async getPreviousPlan(groupId: string): Promise<ReportLine[]> {
    const uid = this.auth.userId();
    if (!uid) return [];
    const prev = this.calendar.previousWorkingDay(this.date());
    const { data } = await this.supa.db('daily_entries')
      .select('plan').eq('report_id', this.reportId(groupId, prev)).eq('user_id', uid).maybeSingle();
    if (!data) return [];
    return ((data.plan ?? []) as ReportLine[]).filter(l => l.text.trim());
  }

  // ---- History ----

  /** Recent reports for a group, newest first. */
  async listRecentReports(groupId: string, max = 20): Promise<DailyReport[]> {
    const { data } = await this.supa.db('daily_reports')
      .select('*').eq('group_id', groupId).order('date', { ascending: false }).limit(max);
    return (data ?? []).map(rowToReport);
  }

  /** Load a past report's full content as a read-only ReportView. */
  async loadHistoricalView(groupId: string, date: string): Promise<ReportView | null> {
    const reportId = this.reportId(groupId, date);
    const { data: reportRow } = await this.supa.db('daily_reports').select('*').eq('id', reportId).maybeSingle();
    if (!reportRow) return null;
    const report = rowToReport(reportRow);
    const { data: entryRows } = await this.supa.db('daily_entries').select('*').eq('report_id', reportId);
    const entries = (entryRows ?? []).map(rowToEntry);
    return buildReportView({
      dateHeader: this.calendar.formatHeader(date),
      entries,
      order: report.memberOrder ?? entries.map(e => e.userId)
    });
  }

  // ---- Helpers ----

  private reportId(groupId: string, date: string): string {
    return `${groupId}_${date}`;
  }
}

// ---- Mapping ----

function rowToReport(r: any): DailyReport {
  return {
    id:          r.id,
    groupId:     r.group_id,
    date:        r.date,
    planForDate: r.plan_for_date,
    status:      r.status,
    lockedBy:    r.locked_by ?? null,
    lockedAt:    r.locked_at ? (toTs(r.locked_at) as any) : null,
    memberOrder: r.member_order ?? [],
    noteId:      r.note_id ?? null,
    createdAt:   toTs(r.created_at) as any,
    updatedAt:   toTs(r.updated_at) as any,
  };
}

function rowToEntry(r: any): DailyEntry {
  return {
    userId:      r.user_id,
    displayName: r.display_name,
    photoURL:    r.photo_url ?? null,
    progress:    r.progress ?? [],
    plan:        r.plan ?? [],
    onLeave:     r.on_leave,
    submitted:   r.submitted,
    updatedAt:   toTs(r.updated_at) as any,
  };
}
