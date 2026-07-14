import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Firestore, collection, doc, getDoc, getDocs, onSnapshot,
  query, where, setDoc, updateDoc, serverTimestamp, Timestamp
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { WorkingCalendarService } from './working-calendar.service';
import { Group } from '@shared/models/group.model';
import {
  DailyReport, DailyEntry, ReportLine, ReportView,
  buildReportView, reportViewToText, reportViewToHtml
} from '@shared/models/daily-report.model';

// ============================================================
// DailyReportService — one team's report for the current working day.
//
// Listens to the parent report doc + its entries subcollection and exposes
// them as signals (mirrors TaskService / GroupService lifecycle). The first
// member to save on a given day lazily creates the parent doc.
// ============================================================

@Injectable({ providedIn: 'root' })
export class DailyReportService {
  private readonly firestore = inject(Firestore);
  private readonly auth      = inject(AuthService);
  private readonly calendar  = inject(WorkingCalendarService);

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

  private unsubReport?:  () => void;
  private unsubEntries?: () => void;

  // ---- Lifecycle ----

  /** Point the service at a group's report for today (IST). */
  startListening(groupId: string): void {
    this.stopListening();
    this.groupId.set(groupId);
    this.isLoading.set(true);

    const date = this.calendar.currentWorkingDay();
    this.date.set(date);
    const reportId = this.reportId(groupId, date);

    this.unsubReport = onSnapshot(
      doc(this.firestore, 'dailyReports', reportId),
      snap => {
        this.report.set(snap.exists() ? ({ id: snap.id, ...snap.data() } as DailyReport) : null);
        this.isLoading.set(false);
      },
      () => this.isLoading.set(false)
    );

    this.unsubEntries = onSnapshot(
      collection(this.firestore, 'dailyReports', reportId, 'entries'),
      snap => this.entries.set(snap.docs.map(d => d.data() as DailyEntry))
    );
  }

  stopListening(): void {
    this.unsubReport?.();
    this.unsubEntries?.();
    this.report.set(null);
    this.entries.set([]);
  }

  // ---- Writes ----

  /** Create the parent report doc if it doesn't exist yet (idempotent). */
  private async ensureReport(group: Group): Promise<string> {
    const date = this.date();
    const reportId = this.reportId(group.id, date);
    if (this.report()) return reportId;

    await setDoc(doc(this.firestore, 'dailyReports', reportId), {
      groupId:     group.id,
      date,
      planForDate: this.calendar.nextWorkingDay(date),
      status:      'draft',
      lockedBy:    null,
      lockedAt:    null,
      memberOrder: group.memberIds,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp()
    }, { merge: true });

    return reportId;
  }

  /** Save the current user's own entry (progress/plan/on-leave/submitted).
   *  `displayName` is the name shown on the report — the member controls it;
   *  falls back to the account name. */
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
    await setDoc(doc(this.firestore, 'dailyReports', reportId, 'entries', uid), {
      userId:      uid,
      displayName: (data.displayName?.trim()) || this.auth.displayName() || 'Member',
      photoURL:    this.auth.photoURL() ?? null,
      progress:    data.progress,
      plan:        data.plan,
      onLeave:     data.onLeave,
      submitted:   data.submitted,
      updatedAt:   serverTimestamp()
    }, { merge: true });
  }

  /** Manager: flag a member on leave (or clear it). Writes that member's entry. */
  async setMemberLeave(group: Group, uid: string, onLeave: boolean, displayName: string): Promise<void> {
    if (this.isLocked()) throw new Error('This report is locked.');
    const reportId = await this.ensureReport(group);
    await setDoc(doc(this.firestore, 'dailyReports', reportId, 'entries', uid), {
      userId:      uid,
      displayName,
      onLeave,
      submitted:   onLeave,          // on-leave counts as "accounted for"
      progress:    onLeave ? [] : (this.entries().find(e => e.userId === uid)?.progress ?? []),
      plan:        onLeave ? [] : (this.entries().find(e => e.userId === uid)?.plan ?? []),
      updatedAt:   serverTimestamp()
    }, { merge: true });
  }

  /** Manager: finalize the report — read-only from here. */
  async lock(): Promise<void> {
    const groupId = this.groupId();
    if (!groupId) return;
    await updateDoc(doc(this.firestore, 'dailyReports', this.reportId(groupId, this.date())), {
      status:    'locked',
      lockedBy:  this.auth.userId(),
      lockedAt:  serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  /** Carry-over: the current user's Plan lines from the previous working day's
   *  report, offered as today's Progress suggestions. Empty if there's none. */
  async getPreviousPlan(groupId: string): Promise<ReportLine[]> {
    const uid = this.auth.userId();
    if (!uid) return [];
    const prev = this.calendar.previousWorkingDay(this.date());
    try {
      const snap = await getDoc(
        doc(this.firestore, 'dailyReports', this.reportId(groupId, prev), 'entries', uid)
      );
      if (!snap.exists()) return [];
      return ((snap.data() as DailyEntry).plan ?? []).filter(l => l.text.trim());
    } catch {
      return [];
    }
  }

  // ---- History ----

  /** Recent reports for a group, newest first. Sorted client-side so no
   *  composite index is required (one doc per working day → small set). */
  async listRecentReports(groupId: string, max = 20): Promise<DailyReport[]> {
    const snap = await getDocs(query(
      collection(this.firestore, 'dailyReports'),
      where('groupId', '==', groupId)
    ));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as DailyReport))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, max);
  }

  /** Load a past report's full content as a read-only ReportView. */
  async loadHistoricalView(groupId: string, date: string): Promise<ReportView | null> {
    const reportId = this.reportId(groupId, date);
    const reportSnap = await getDoc(doc(this.firestore, 'dailyReports', reportId));
    if (!reportSnap.exists()) return null;
    const report = reportSnap.data() as DailyReport;
    const entriesSnap = await getDocs(collection(this.firestore, 'dailyReports', reportId, 'entries'));
    const entries = entriesSnap.docs.map(d => d.data() as DailyEntry);
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
