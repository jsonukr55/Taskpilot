import { Component, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { GroupService } from '@core/services/group.service';
import { DailyReportService } from '@core/services/daily-report.service';
import { WorkingCalendarService } from '@core/services/working-calendar.service';
import { TaskService } from '@core/services/task.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { NoteService } from '@core/services/note.service';
import { NoteBlock, newBlock } from '@shared/models/note.model';
import { IconComponent } from '@shared/components/icon/icon.component';
import { SelectComponent, SelectOption } from '@shared/components/select/select.component';
import { Group, groupMembers, GroupMember } from '@shared/models/group.model';
import { TaskStatus } from '@shared/models/task.model';
import { Timestamp } from '@angular/fire/firestore';
import {
  ReportLine, ReportView, newLine, entryStatus, EntryStatus, ENTRY_STATUS_LABELS
} from '@shared/models/daily-report.model';

/** A one-click line drawn from one of the user's tasks (hybrid pre-fill). */
interface TaskSuggestion { taskId: string; text: string; }

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
  /** localStorage key for remembering the last-selected team. */
  private static readonly LAST_TEAM_KEY = 'taskpilot:daily:lastTeam';

  readonly groups   = inject(GroupService);
  readonly daily    = inject(DailyReportService);
  readonly calendar = inject(WorkingCalendarService);
  readonly tasks    = inject(TaskService);
  private readonly toast  = inject(ToastService);
  private readonly auth   = inject(AuthService);
  private readonly notes  = inject(NoteService);
  private readonly router = inject(Router);

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
  readonly displayName   = signal('');   // name shown for me on the report
  readonly progressLines = signal<ReportLine[]>([newLine()]);
  readonly planLines     = signal<ReportLine[]>([newLine()]);
  readonly onLeave       = signal(false);
  private readonly dirty = signal(false);

  readonly isSaving  = signal(false);
  readonly showRaw   = signal(false);   // preview: formatted card vs raw paste text

  readonly isWorkingToday = computed(() => this.calendar.isWorkingDay(this.daily.date()));
  readonly todayHolidayName = computed(() => this.calendar.holidayName(this.daily.date()));

  // ---- Phase 2: hybrid pre-fill ----
  // Carry-over: your Plan from the previous working day, loaded on team select.
  private readonly carryOverPlan = signal<ReportLine[]>([]);

  /** Tasks you completed today (IST) or are in progress → Progress suggestions. */
  readonly progressSuggestions = computed<TaskSuggestion[]>(() => {
    const today = this.daily.date();
    const used  = new Set(this.progressLines().map(l => l.taskId).filter(Boolean));
    return this.tasks.tasks()
      .filter(t => {
        const completedToday = t.status === 'completed' && !!t.completedAt
          && this.calendar.toDateStr(t.completedAt.toDate()) === today;
        return completedToday || t.status === 'in_progress';
      })
      .filter(t => !used.has(t.id))
      .map(t => ({ taskId: t.id, text: t.title }));
  });

  /** Tasks due the next working day or still in progress → Plan suggestions. */
  readonly planSuggestions = computed<TaskSuggestion[]>(() => {
    const planDate = this.daily.planForDate();
    const used     = new Set(this.planLines().map(l => l.taskId).filter(Boolean));
    return this.tasks.tasks()
      .filter(t => t.status !== 'completed' && t.status !== 'cancelled')
      .filter(t => {
        const dueNext = !!t.dueDate && this.calendar.toDateStr(t.dueDate.toDate()) === planDate;
        return dueNext || t.status === 'in_progress';
      })
      .filter(t => !used.has(t.id))
      .map(t => ({ taskId: t.id, text: t.title }));
  });

  /** Yesterday's plan lines not already added to today's Progress. */
  readonly carryOverSuggestions = computed<ReportLine[]>(() => {
    const usedText = new Set(this.progressLines().map(l => l.text.trim()).filter(Boolean));
    return this.carryOverPlan().filter(l => !usedText.has(l.text.trim()));
  });

  constructor() {
    // Auto-select a team once groups load: prefer the last-used one, else the first.
    effect(() => {
      const list = this.groups.groups();
      if (!this.selectedGroupId() && list.length) {
        const stored = localStorage.getItem(DailyReportComponent.LAST_TEAM_KEY);
        const restore = stored && list.some(g => g.id === stored) ? stored : list[0].id;
        this.selectGroup(restore);
      }
    }, { allowSignalWrites: true });

    // Seed the editor from the saved entry — but never stomp in-progress edits.
    effect(() => {
      const entry = this.daily.myEntry();
      if (this.dirty()) return;
      this.displayName.set(entry?.displayName || this.auth.displayName() || '');
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
    localStorage.setItem(DailyReportComponent.LAST_TEAM_KEY, id);
    this.dirty.set(false);
    this.daily.startListening(id);
    // Carry-over: pull the previous working day's plan for a "did you do these?" prompt.
    this.carryOverPlan.set([]);
    this.daily.getPreviousPlan(id).then(lines => this.carryOverPlan.set(lines));
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

  onNameInput(value: string): void {
    this.displayName.set(value);
    this.dirty.set(true);
  }

  /** Append a suggestion as an editable line, dropping the empty placeholder. */
  private appendLine(which: Which, text: string, taskId: string | null): void {
    this.linesFor(which).update(list => {
      const kept = list.filter(l => l.text.trim());
      return [...kept, newLine(text, taskId)];
    });
    this.dirty.set(true);
  }

  addTaskSuggestion(which: Which, s: TaskSuggestion): void {
    this.appendLine(which, s.text, s.taskId);
  }

  addCarryOver(line: ReportLine): void {
    this.appendLine('progress', line.text, line.taskId ?? null);
  }

  trackLine = (_: number, l: ReportLine) => l.id;

  private cleaned(lines: ReportLine[]): ReportLine[] {
    return lines.map(l => ({ ...l, text: l.text.trim() })).filter(l => l.text);
  }

  // ---- Save / submit ----

  async save(submitted: boolean): Promise<void> {
    const group = this.selectedGroup();
    if (!group) { this.toast.error('No team selected — create or join a group first.'); return; }
    if (this.daily.isLocked()) return;
    this.isSaving.set(true);
    try {
      const onLeave = this.onLeave();
      if (!onLeave) {
        // Keep a personal record: hand-typed lines become tasks in My Tasks.
        // Progress → completed (work done), Plan → to-do (upcoming work).
        await this.recordLinesAsTasks('progress', 'completed');
        await this.recordLinesAsTasks('plan', 'todo');
      }
      await this.daily.saveMyEntry(group, {
        progress:    onLeave ? [] : this.cleaned(this.progressLines()),
        plan:        onLeave ? [] : this.cleaned(this.planLines()),
        onLeave,
        submitted,
        displayName: this.displayName()
      });
      this.dirty.set(false);
      this.toast.success(submitted ? 'Update submitted' : 'Draft saved');
    } catch (err: any) {
      console.error('[daily] save failed', err);
      this.toast.error(this.describeError(err));
    } finally {
      this.isSaving.set(false);
    }
  }

  /**
   * Mirror each hand-typed report line into the user's own task list so they
   * have a record. A line is only recorded once — we stamp the new task's id
   * back onto the line (taskId), so re-saving never creates duplicates, and
   * lines already linked to a source task (from suggestions) are skipped.
   */
  private async recordLinesAsTasks(which: Which, status: TaskStatus): Promise<void> {
    const lines = this.linesFor(which)();
    for (const line of lines) {
      const title = line.text.trim();
      if (!title || line.taskId) continue;
      try {
        const id = await this.tasks.createTask({
          title,
          description: '',
          status,
          priority: 'medium',
          tags: ['daily-report'],
          categoryIds: [],
          checklist: [],
          timeBlocks: [],
          reminders: [],
          isScheduled: false,
          completedAt: status === 'completed' ? Timestamp.now() : null,
        });
        this.linesFor(which).update(list =>
          list.map(l => (l.id === line.id ? { ...l, taskId: id } : l))
        );
      } catch (err) {
        // Never let a task-create failure block the actual report save.
        console.error('[daily] failed to record line as task', err);
      }
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
      this.toast.error(this.describeError(err));
    }
  }

  /**
   * Copy the report for Teams. Writes BOTH rich HTML and plain text to the
   * clipboard: Teams (and most editors) take the HTML, so the paste renders
   * bold headers/names + bulleted lists; anything plain-text-only falls back
   * to the flat version.
   */
  async copyReport(): Promise<void> {
    const html = this.daily.reportHtml();
    const text = this.daily.reportText();
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html':  new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      this.toast.success('Report copied — paste into Teams');
    } catch (err) {
      // Rich copy unsupported/blocked → fall back to plain text.
      try {
        await navigator.clipboard.writeText(text);
        this.toast.info('Copied as plain text');
      } catch {
        this.toast.error('Could not access the clipboard');
      }
    }
  }

  /** Import the report into a new personal Note the user can freely edit. */
  async sendToNotes(): Promise<void> {
    const view = this.daily.reportView();
    try {
      const id = await this.notes.createNote(null, `Daily Report — ${this.daily.dateHeader()}`);
      await this.notes.updateNote(null, id, { blocks: this.reportToBlocks(view), icon: '📋' });
      this.toast.success('Imported to Notes');
      this.router.navigate(['/notes', id]);
    } catch (err: any) {
      console.error('[daily] send to notes failed', err);
      this.toast.error('Could not create the note');
    }
  }

  /** Turn the report into editable note blocks (headings + bullets). */
  private reportToBlocks(view: ReportView): NoteBlock[] {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const blocks: NoteBlock[] = [
      newBlock('paragraph', 'Hi Everyone,'),
      newBlock('paragraph', `Date: ${esc(view.dateHeader)}`),
      newBlock('h2', 'Progress Update')
    ];
    for (const r of view.progress) {
      blocks.push(newBlock('h3', esc(r.displayName)));
      if (r.onLeave) blocks.push(newBlock('paragraph', 'On leave'));
      else r.lines.forEach(l => blocks.push(newBlock('bulleted', esc(l))));
    }
    blocks.push(newBlock('h2', 'Plan for Tomorrow'));
    for (const r of view.plan) {
      blocks.push(newBlock('h3', esc(r.displayName)));
      r.lines.forEach(l => blocks.push(newBlock('bulleted', esc(l))));
    }
    return blocks;
  }

  async lock(): Promise<void> {
    if (!this.isManager()) return;
    if (!confirm('Lock this report? Nobody will be able to edit it afterwards.')) return;
    try {
      await this.daily.lock();
      this.toast.success('Report locked');
    } catch (err: any) {
      console.error('[daily] lock failed', err);
      this.toast.error(this.describeError(err));
    }
  }
}
