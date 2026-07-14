import { Component, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { GroupService } from '@core/services/group.service';
import { DailyReportService } from '@core/services/daily-report.service';
import { WorkingCalendarService } from '@core/services/working-calendar.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { SelectComponent, SelectOption } from '@shared/components/select/select.component';
import { Group, groupMembers, GroupMember } from '@shared/models/group.model';
import {
  ReportLine, newLine, entryStatus, EntryStatus, ENTRY_STATUS_LABELS
} from '@shared/models/daily-report.model';

// ============================================================
// DailyReportComponent — the /daily page.
//   • Every member edits their own Progress / Plan (+ On leave, Submit).
//   • The manager (group owner) also gets a team panel: roster status,
//     live report preview, Copy for Teams, and Lock & finalize.
// Editing is disabled once the manager locks the day.
// ============================================================

type Which = 'progress' | 'plan';

@Component({
  selector:    'tp-daily-report',
  standalone:  true,
  imports:     [RouterLink, FormsModule, IconComponent, SelectComponent],
  templateUrl: './daily-report.component.html',
  styleUrl:    './daily-report.component.scss'
})
export class DailyReportComponent implements OnDestroy {
  readonly groups   = inject(GroupService);
  readonly daily    = inject(DailyReportService);
  readonly calendar = inject(WorkingCalendarService);

  // ---- Team selection ----
  readonly selectedGroupId = signal<string | null>(null);
  readonly selectedGroup = computed<Group | undefined>(() => {
    const id = this.selectedGroupId();
    return id ? this.groups.getGroupById(id) : undefined;
  });
  readonly isManager = computed(() => this.groups.isOwner(this.selectedGroup()));
  readonly roster = computed<GroupMember[]>(() => {
    const g = this.selectedGroup();
    return g ? groupMembers(g) : [];
  });
  readonly teamOptions = computed<SelectOption[]>(() =>
    this.groups.groups().map(g => ({ value: g.id, label: g.name, icon: g.icon }))
  );

  // ---- Local editable state (my entry) ----
  readonly progressLines = signal<ReportLine[]>([newLine()]);
  readonly planLines     = signal<ReportLine[]>([newLine()]);
  readonly onLeave       = signal(false);
  private readonly dirty = signal(false);

  readonly isSaving  = signal(false);
  readonly copied    = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly isWorkingToday = computed(() => this.calendar.isWorkingDay(this.daily.date()));
  readonly todayHolidayName = computed(() => this.calendar.holidayName(this.daily.date()));

  constructor() {
    // Auto-select the first team (single-team setup). Re-runs if groups load in.
    effect(() => {
      const list = this.groups.groups();
      if (!this.selectedGroupId() && list.length) {
        this.selectGroup(list[0].id);
      }
    }, { allowSignalWrites: true });

    // Seed the editor from the saved entry — but never stomp in-progress edits.
    effect(() => {
      const entry = this.daily.myEntry();
      if (this.dirty()) return;
      this.progressLines.set(entry?.progress?.length ? entry.progress.map(l => ({ ...l })) : [newLine()]);
      this.planLines.set(entry?.plan?.length ? entry.plan.map(l => ({ ...l })) : [newLine()]);
      this.onLeave.set(entry?.onLeave ?? false);
    }, { allowSignalWrites: true });
  }

  ngOnDestroy(): void {
    this.daily.stopListening();
  }

  selectGroup(id: string): void {
    if (id === this.selectedGroupId()) return;
    this.selectedGroupId.set(id);
    this.dirty.set(false);
    this.daily.startListening(id);
  }

  // ---- Line editing ----

  private linesFor(which: Which) {
    return which === 'progress' ? this.progressLines : this.planLines;
  }

  addLine(which: Which): void {
    this.linesFor(which).update(list => [...list, newLine()]);
    this.dirty.set(true);
  }

  removeLine(which: Which, id: string): void {
    this.linesFor(which).update(list => {
      const next = list.filter(l => l.id !== id);
      return next.length ? next : [newLine()];
    });
    this.dirty.set(true);
  }

  onLineInput(which: Which, id: string, text: string): void {
    this.linesFor(which).update(list => list.map(l => l.id === id ? { ...l, text } : l));
    this.dirty.set(true);
  }

  toggleOnLeave(): void {
    this.onLeave.update(v => !v);
    this.dirty.set(true);
  }

  trackLine = (_: number, l: ReportLine) => l.id;

  private cleaned(lines: ReportLine[]): ReportLine[] {
    return lines.map(l => ({ ...l, text: l.text.trim() })).filter(l => l.text);
  }

  // ---- Save / submit ----

  async save(submitted: boolean): Promise<void> {
    const group = this.selectedGroup();
    if (!group) { this.saveError.set('No team selected — create or join a group first.'); return; }
    if (this.daily.isLocked()) return;
    this.isSaving.set(true);
    this.saveError.set(null);
    try {
      const onLeave = this.onLeave();
      await this.daily.saveMyEntry(group, {
        progress:  onLeave ? [] : this.cleaned(this.progressLines()),
        plan:      onLeave ? [] : this.cleaned(this.planLines()),
        onLeave,
        submitted
      });
      this.dirty.set(false);
    } catch (err: any) {
      console.error('[daily] save failed', err);
      this.saveError.set(this.describeError(err));
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Turn a Firestore error into something actionable for the banner. */
  private describeError(err: any): string {
    const code: string = err?.code ?? '';
    if (code === 'permission-denied') {
      return 'Save blocked by Firestore rules — the dailyReports rules may not be deployed yet '
           + '(run: firebase deploy --only firestore:rules).';
    }
    return err?.message || 'Save failed. Check the console for details.';
  }

  // ---- Manager actions ----

  statusOf(uid: string): EntryStatus {
    return entryStatus(this.daily.entries().find(e => e.userId === uid));
  }
  statusLabel(uid: string): string {
    return ENTRY_STATUS_LABELS[this.statusOf(uid)];
  }

  async toggleMemberLeave(member: GroupMember): Promise<void> {
    const group = this.selectedGroup();
    if (!group || this.daily.isLocked()) return;
    const currentlyOnLeave = this.statusOf(member.userId) === 'onLeave';
    try {
      await this.daily.setMemberLeave(group, member.userId, !currentlyOnLeave, member.displayName);
    } catch (err: any) {
      console.error('[daily] setMemberLeave failed', err);
      this.saveError.set(this.describeError(err));
    }
  }

  async copyReport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.daily.reportText());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard blocked (e.g. insecure context) — no-op; text stays visible to select.
    }
  }

  async lock(): Promise<void> {
    if (!this.isManager()) return;
    if (!confirm('Lock this report? Nobody will be able to edit it afterwards.')) return;
    try {
      await this.daily.lock();
    } catch (err: any) {
      console.error('[daily] lock failed', err);
      this.saveError.set(this.describeError(err));
    }
  }
}
