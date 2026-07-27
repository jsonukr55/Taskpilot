import { Component, inject, input, computed, signal, HostListener, OnInit, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Timestamp } from '@angular/fire/firestore';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { SpaceService } from '@core/services/space.service';
import { SpaceGroupService } from '@core/services/space-group.service';
import { SpaceColumnService } from '@core/services/space-column.service';
import { OrganizationService } from '@core/services/organization.service';
import { TaskService } from '@core/services/task.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { DialogService } from '@core/services/dialog.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { MenuComponent, MenuItem } from '@shared/components/menu/menu.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';
import { TaskDrawerComponent } from '@shared/components/task-drawer/task-drawer.component';
import { spaceMembers, SpaceRole, ASSIGNABLE_SPACE_ROLES, SPACE_ROLE_LABELS } from '@shared/models/space.model';
import { SpaceGroup } from '@shared/models/space-group.model';
import { SpaceColumn, SpaceColumnType, SPACE_COLUMN_TYPES } from '@shared/models/space-column.model';
import { Task, TaskPriority, TaskStage, TASK_STAGES, TASK_STAGE_LABELS } from '@shared/models/task.model';

type BoardView = 'section' | 'status' | 'sprint';
interface BoardColumn {
  key: string; name: string; color: string;
  kind: BoardView; canManage: boolean; tasks: Task[]; group?: SpaceGroup;
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};
const STAGE_HEX: Record<TaskStage, string> = {
  created: '#94a3b8', in_discussion: '#0ea5e9', development: '#f59e0b',
  done: '#10b981', released: '#8b5cf6', production: '#059669',
};

@Component({
  selector:   'tp-space-detail',
  standalone: true,
  imports:    [RouterLink, FormsModule, DatePipe, NgTemplateOutlet, DragDropModule, IconComponent, MenuComponent, TooltipDirective, TaskDrawerComponent],
  templateUrl: './space-detail.component.html',
  styleUrl:    './space-detail.component.scss'
})
export class SpaceDetailComponent implements OnInit, OnDestroy {
  orgId   = input.required<string>();
  spaceId = input.required<string>();

  readonly spaces       = inject(SpaceService);
  readonly spaceGroups  = inject(SpaceGroupService);
  readonly spaceColumns = inject(SpaceColumnService);
  readonly orgs         = inject(OrganizationService);
  readonly tasks       = inject(TaskService);
  readonly auth        = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly space    = computed(() => this.spaces.getSpaceById(this.spaceId()));
  readonly notFound = computed(() => !this.spaces.isLoading() && !this.space());
  readonly members  = computed(() => { const s = this.space(); return s ? spaceMembers(s) : []; });
  readonly canEdit  = computed(() => this.spaces.canEditSpace(this.space()));
  readonly isOwner  = computed(() => this.spaces.isSpaceOwner(this.space()));

  /** Space owner OR an org manager (owner/admin/global admin) may add,
   *  re-role and remove space members. Mirrors the space_members RLS. */
  readonly canManageMembers = computed(() =>
    this.isOwner() || this.orgs.canManageOrg(this.orgs.getOrgById(this.orgId())));

  /** Root tasks in this space (subtasks render as nested rows). */
  readonly rootTasks = computed(() =>
    this.tasks.spaceTasks().filter(t => !t.parentId)
  );

  /** Space subtasks grouped by parent (from the space-scoped task set, since
   *  the board loads spaceTasks() — the global getSubtasks() doesn't see these). */
  readonly subByParent = computed(() => {
    const m = new Map<string, Task[]>();
    for (const t of this.tasks.spaceTasks()) {
      if (t.parentId) { const a = m.get(t.parentId); a ? a.push(t) : m.set(t.parentId, [t]); }
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return m;
  });
  subtasksOf   = (id: string): Task[] => this.subByParent().get(id) ?? [];
  childCountOf = (id: string): number => this.subtasksOf(id).length;

  // Inline subtask expand/collapse per row.
  readonly expandedRows = signal<Set<string>>(new Set());
  isRowOpen = (id: string): boolean => this.expandedRows().has(id);
  toggleRow(id: string): void {
    this.expandedRows.update(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async addSubtaskInline(parentId: string, input: HTMLInputElement): Promise<void> {
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    try {
      await this.tasks.createSubtask(parentId, title);
      this.expandedRows.update(s => new Set(s).add(parentId));   // keep it open to show the new child
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not add the subtask');
    }
  }

  // ---- Board views: Table (sections) / Status (stage) / Sprint ----
  readonly view = signal<BoardView>('section');
  readonly VIEWS: { value: BoardView; label: string; icon: string }[] = [
    { value: 'section', label: 'Table',  icon: 'grid' },
    { value: 'status',  label: 'Status', icon: 'check-square' },
    { value: 'sprint',  label: 'Sprint', icon: 'repeat' },
  ];
  setView(v: BoardView): void {
    this.view.set(v);
    try { localStorage.setItem('space-view:' + this.spaceId(), v); } catch { /* ignore */ }
  }

  /** Board columns for the current view. */
  readonly columns = computed<BoardColumn[]>(() => {
    const tasks = this.rootTasks();
    const byPos = (a: Task, b: Task) => (a.position ?? 0) - (b.position ?? 0);

    switch (this.view()) {
      case 'status':
        return TASK_STAGES.map(s => ({
          key: s.value, name: s.label, color: STAGE_HEX[s.value], kind: 'status' as const, canManage: false,
          tasks: tasks.filter(t => (t.stage ?? 'created') === s.value).sort(byPos),
        }));
      case 'sprint': {
        const sprints = [...new Set(tasks.map(t => t.sprint).filter((s): s is string => !!s))].sort();
        const cols: BoardColumn[] = sprints.map(sp => ({
          key: sp, name: sp, color: '#6366f1', kind: 'sprint' as const, canManage: false,
          tasks: tasks.filter(t => t.sprint === sp).sort(byPos),
        }));
        cols.push({ key: '__none', name: 'No sprint', color: '#94a3b8', kind: 'sprint', canManage: false,
          tasks: tasks.filter(t => !t.sprint).sort(byPos) });
        return cols;
      }
      default: {
        const groups = this.spaceGroups.groups();
        const byGroup = new Map<string, Task[]>();
        groups.forEach(g => byGroup.set(g.id, []));
        const ungrouped: Task[] = [];
        for (const t of tasks) {
          const b = t.spaceGroupId && byGroup.has(t.spaceGroupId) ? byGroup.get(t.spaceGroupId)! : ungrouped;
          b.push(t);
        }
        const cols: BoardColumn[] = groups.map(g => ({
          key: g.id, name: g.name, color: g.color, kind: 'section' as const, canManage: true, group: g,
          tasks: (byGroup.get(g.id) ?? []).sort(byPos),
        }));
        if (ungrouped.length) cols.unshift({ key: '__ungrouped', name: 'Ungrouped', color: '#94a3b8', kind: 'section', canManage: false, tasks: ungrouped.sort(byPos) });
        return cols;
      }
    }
  });

  readonly selectedTask = signal<Task | null>(null);

  /** Org members not already in this space (for the add-member picker). */
  readonly addableMembers = computed(() => {
    const org = this.orgs.getOrgById(this.orgId());
    const s   = this.space();
    if (!org || !s) return [];
    return org.memberIds
      .filter(uid => !s.memberIds.includes(uid))
      .map(uid => ({ uid, profile: org.memberProfiles[uid] ?? { displayName: 'Member', photoURL: null } }));
  });

  readonly showMembers = signal(false);

  ngOnInit(): void {
    this.tasks.openSpaceTasks(this.spaceId());
    this.spaceGroups.open(this.spaceId());
    this.spaceColumns.open(this.spaceId());
    this.loadWidths();
    try {
      const saved = localStorage.getItem('space-view:' + this.spaceId());
      if (saved === 'section' || saved === 'status' || saved === 'sprint') this.view.set(saved);
    } catch { /* ignore */ }
  }
  ngOnDestroy(): void {
    this.tasks.closeSpaceTasks();
    this.spaceGroups.close();
    this.spaceColumns.close();
  }

  // ---- Columns: built-in fields (in render order) + resizable widths ----
  readonly FIELDS: { key: string; label: string; def: number; min: number }[] = [
    { key: 'task',     label: 'Task',     def: 260, min: 160 },
    { key: 'status',   label: 'Status',   def: 148, min: 110 },
    { key: 'priority', label: 'Priority', def: 120, min: 96 },
    { key: 'assignee', label: 'Assignee', def: 128, min: 90 },
    { key: 'pmpo',     label: 'PM/PO',    def: 110, min: 80 },
    { key: 'start',    label: 'Start',    def: 128, min: 96 },
    { key: 'due',      label: 'Due',      def: 128, min: 96 },
    { key: 'duetime',  label: 'Due time', def: 108, min: 90 },
    { key: 'est',      label: 'Est (h)',  def: 84,  min: 64 },
    { key: 'tags',     label: 'Tags',     def: 160, min: 110 },
    { key: 'sprint',   label: 'Sprint',   def: 120, min: 96 },
  ];
  private static readonly CUSTOM_DEFAULT = 140;
  private static readonly CUSTOM_MIN = 90;
  private readonly FIELD_MAP = new Map(this.FIELDS.map(f => [f.key, f]));

  readonly colWidths = signal<Record<string, number>>({});   // default widths, keyed by wkey
  readonly colOrder  = signal<string[]>([]);                 // column order (excl. 'task')
  // Per-task width overrides: rootTaskId -> { wkey -> px }. A task's row and
  // ALL its subtasks follow the task's own widths (falling back to defaults).
  readonly taskWidths = signal<Record<string, Record<string, number>>>({});
  // The top-level task currently being customized (its widths drive the header).
  readonly selectedRow = signal<string | null>(null);

  private widthsKey():    string { return 'space-cols:' + this.spaceId(); }
  private orderKey():     string { return 'space-colorder:' + this.spaceId(); }
  private taskColsKey():  string { return 'space-taskcols:' + this.spaceId(); }

  private loadWidths(): void {
    const read = (k: string, fb: any) => {
      try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; }
    };
    this.colWidths.set(read(this.widthsKey(), {}));
    this.colOrder.set(read(this.orderKey(), []));
    this.taskWidths.set(read(this.taskColsKey(), {}));
  }
  widthOf = (wkey: string, fallback: number): number => this.colWidths()[wkey] ?? fallback;
  /** Width for a column within a specific task's block (override → default → fallback). */
  widthForTask = (rootId: string, wkey: string, fallback: number): number =>
    this.taskWidths()[rootId]?.[wkey] ?? this.colWidths()[wkey] ?? fallback;

  toggleSelectRow(id: string): void { this.selectedRow.update(v => v === id ? null : id); }

  /** Columns for a task's block: built-in fields + board-wide custom columns
   *  + (for a specific task) that task's own custom columns. `rootId` null =
   *  board-wide only (the default header). */
  columnsFor(rootId: string | null) {
    const customs = this.spaceColumns.columns().filter(c => !c.taskId || c.taskId === rootId);
    const valid = [
      ...this.FIELDS.filter(f => f.key !== 'task').map(f => f.key),
      ...customs.map(cc => 'cc:' + cc.id),
    ];
    const stored = this.colOrder().filter(k => valid.includes(k));
    const ordered = [...stored, ...valid.filter(k => !stored.includes(k))];
    return ordered.map(key => {
      if (key.startsWith('cc:')) {
        const cc = customs.find(c => 'cc:' + c.id === key)!;
        return { key, wkey: 'cc:' + cc.id, kind: 'custom' as const, label: cc.name, min: SpaceDetailComponent.CUSTOM_MIN, def: SpaceDetailComponent.CUSTOM_DEFAULT, custom: cc as SpaceColumn | undefined };
      }
      const f = this.FIELD_MAP.get(key)!;
      return { key, wkey: key, kind: 'field' as const, label: f.label, min: f.min, def: f.def, custom: undefined as SpaceColumn | undefined };
    });
  }

  readonly itemCols   = computed(() => this.columnsFor(null));                       // board-wide (default)
  readonly headerCols = computed(() => this.columnsFor(this.selectedRow()));         // header follows selection

  private gridFrom(cols: ReturnType<SpaceDetailComponent['columnsFor']>, rootId: string | null): string {
    const w = (wkey: string, def: number) => rootId ? this.widthForTask(rootId, wkey, def) : this.widthOf(wkey, def);
    return [w('task', 260) + 'px', ...cols.map(c => w(c.wkey, c.def) + 'px'), '44px'].join(' ');
  }
  readonly gridTemplate = computed(() => this.gridFrom(this.itemCols(), null));
  /** Grid for a task's own block (row + subtasks): its columns + width overrides. */
  gridTemplateForTask(rootId: string): string {
    return this.gridFrom(this.columnsFor(rootId), rootId);
  }
  /** Header mirrors the selected task's columns + widths. */
  readonly headerGrid = computed(() => {
    const sel = this.selectedRow();
    return sel ? this.gridTemplateForTask(sel) : this.gridTemplate();
  });


  // ---- Column reordering (native drag on header labels) ----
  readonly dragCol = signal<string | null>(null);
  colDragStart(key: string, ev: DragEvent): void {
    this.dragCol.set(key);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }
  private reorder(keys: string[], from: string, target: string): string[] {
    const fi = keys.indexOf(from), ti = keys.indexOf(target);
    if (fi < 0 || ti < 0) return keys;
    const arr = [...keys];
    arr.splice(fi, 1);
    let at = arr.indexOf(target);
    if (ti > fi) at += 1;
    arr.splice(at, 0, from);
    return arr;
  }
  colDrop(targetKey: string, ev: DragEvent): void {
    ev.preventDefault();
    const from = this.dragCol(); this.dragCol.set(null);
    if (!from || from === targetKey) return;
    const next = this.reorder(this.headerCols().map(c => c.key), from, targetKey);
    this.colOrder.set(next);
    try { localStorage.setItem(this.orderKey(), JSON.stringify(next)); } catch { /* ignore */ }
  }

  // ---- Column resize (pointer drag on a header's right edge) ----
  //   When a task is selected, the drag writes that task's width override;
  //   otherwise it sets the board default.
  private resizing?: { key: string; startX: number; startW: number; min: number; rootId: string | null };

  startResize(wkey: string, def: number, min: number, ev: PointerEvent): void {
    ev.preventDefault(); ev.stopPropagation();
    const rootId = this.selectedRow();
    const startW = rootId ? this.widthForTask(rootId, wkey, def) : this.widthOf(wkey, def);
    this.resizing = { key: wkey, startX: ev.clientX, startW, min, rootId };
    document.body.style.userSelect = 'none';
  }
  @HostListener('document:pointermove', ['$event'])
  onResizeMove(ev: PointerEvent): void {
    if (!this.resizing) return;
    const w = Math.max(this.resizing.min, this.resizing.startW + (ev.clientX - this.resizing.startX));
    const { key, rootId } = this.resizing;
    if (rootId) {
      this.taskWidths.update(m => ({ ...m, [rootId]: { ...(m[rootId] ?? {}), [key]: w } }));
    } else {
      this.colWidths.update(m => ({ ...m, [key]: w }));
    }
  }
  @HostListener('document:pointerup')
  endResize(): void {
    if (!this.resizing) return;
    const wasTask = !!this.resizing.rootId;
    this.resizing = undefined;
    document.body.style.userSelect = '';
    try {
      if (wasTask) localStorage.setItem(this.taskColsKey(), JSON.stringify(this.taskWidths()));
      else localStorage.setItem(this.widthsKey(), JSON.stringify(this.colWidths()));
    } catch { /* ignore */ }
  }

  // ---- Custom columns ----
  readonly COLUMN_TYPES = SPACE_COLUMN_TYPES;

  fieldValue = (t: Task, colId: string): string | number | null => t.customFields?.[colId] ?? null;

  /** Resolve a member custom-field value (a profile uid) to a display name / photo. */
  memberLabel = (uid: string | number | null): string =>
    uid ? (this.members().find(m => m.userId === uid)?.displayName ?? '—') : '—';
  memberPhoto = (uid: string | number | null): string | null =>
    uid ? (this.members().find(m => m.userId === uid)?.photoURL ?? null) : null;

  // Member custom-column picker (single select), keyed by task + column.
  readonly memberFor = signal<string | null>(null);
  private mkey = (taskId: string, colId: string) => taskId + ':' + colId;
  isMemberPickOpen = (taskId: string, colId: string): boolean => this.memberFor() === this.mkey(taskId, colId);
  toggleMemberPick(taskId: string, colId: string): void {
    const k = this.mkey(taskId, colId);
    this.memberFor.update(v => v === k ? null : k);
  }
  async setMember(t: Task, colId: string, uid: string): Promise<void> {
    this.memberFor.set(null);
    await this.setCustomField(t, colId, uid);
  }

  /** PM/PO built-in member field (reuses the member-picker open state). */
  async setPmPo(t: Task, uid: string): Promise<void> {
    this.memberFor.set(null);
    await this.patch(t.id, { pmPo: uid || null });
  }

  async setCustomField(t: Task, colId: string, value: string): Promise<void> {
    const cf = { ...(t.customFields ?? {}), [colId]: value === '' ? null : value };
    try { await this.tasks.updateTask(t.id, { customFields: cf }); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not update the field'); }
  }

  async deleteColumn(c: SpaceColumn): Promise<void> {
    if (!(await this.dialog.confirm({ title: 'Delete column', message: `Delete column "${c.name}"? Its values are removed from the board.`, confirmText: 'Delete', danger: true }))) return;
    try { await this.spaceColumns.remove(c.id); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not delete the column'); }
  }

  // Add-column dialog
  readonly showAddColumn = signal(false);
  readonly newColName    = signal('');
  readonly newColType    = signal<SpaceColumnType>('text');
  readonly newColOptions = signal('');   // comma-separated for dropdown

  openAddColumn(): void {
    this.newColName.set(''); this.newColType.set('text'); this.newColOptions.set('');
    this.showAddColumn.set(true);
  }
  async createColumn(): Promise<void> {
    const name = this.newColName().trim();
    if (!name) return;
    const options = this.newColType() === 'dropdown'
      ? this.newColOptions().split(',').map(s => s.trim()).filter(Boolean) : [];
    try {
      // If a task is selected, the new column belongs to just that task.
      await this.spaceColumns.create(this.spaceId(), name, this.newColType(), options, this.selectedRow());
      this.showAddColumn.set(false);
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not add the column');
    }
  }

  initial = (name: string): string => (name?.charAt(0) || '?').toUpperCase();

  // ---- Section (Group) management ----

  async addGroup(): Promise<void> {
    try { await this.spaceGroups.create(this.spaceId()); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not add the section'); }
  }

  async renameGroup(g: SpaceGroup, name: string): Promise<void> {
    const n = name.trim();
    if (!n || n === g.name) return;
    try { await this.spaceGroups.update(g.id, { name: n }); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not rename the section'); }
  }

  async deleteGroup(g: SpaceGroup): Promise<void> {
    if (!(await this.dialog.confirm({ title: 'Delete section', message: `Delete section "${g.name}"? Its tasks stay in the space but become ungrouped.`, confirmText: 'Delete', danger: true }))) return;
    try { await this.spaceGroups.remove(g.id); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not delete the section'); }
  }

  // ---- Tasks ----

  async addTask(col: BoardColumn, input: HTMLInputElement): Promise<void> {
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    const extra: { spaceGroupId?: string | null; stage?: TaskStage; sprint?: string | null } = {};
    if (col.kind === 'section')      extra.spaceGroupId = col.key === '__ungrouped' ? null : col.key;
    else if (col.kind === 'status')  extra.stage  = col.key as TaskStage;
    else if (col.kind === 'sprint')  extra.sprint = col.key === '__none' ? null : col.key;
    try {
      await this.tasks.createSpaceTask(this.spaceId(), this.orgId(), { title, position: col.tasks.length, ...extra });
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not create the task');
    }
  }

  /** Drag-drop: reorder within a column, or move across — which changes the
   *  grouping dimension's value (section / stage / sprint) to the drop target. */
  async drop(event: CdkDragDrop<Task[]>, col: BoardColumn): Promise<void> {
    const task = event.item.data as Task;
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(event.previousContainer.data, event.container.data, event.previousIndex, event.currentIndex);
    }
    try {
      if (col.kind === 'section') {
        const gid = col.key === '__ungrouped' ? null : col.key;
        await this.tasks.moveToGroup(task.id, gid, event.currentIndex);
        await Promise.all(event.container.data.map((t, i) =>
          t.id === task.id ? Promise.resolve() : this.tasks.updateTask(t.id, { position: i })));
      } else if (col.kind === 'status') {
        await this.tasks.setStage(task.id, col.key as TaskStage);
      } else {
        await this.tasks.setSprint(task.id, col.key === '__none' ? null : col.key);
      }
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not move the task');
    }
  }

  async setSprint(taskId: string, value: string): Promise<void> {
    try { await this.tasks.setSprint(taskId, value.trim() || null); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not update sprint'); }
  }

  // ---- Inline cell edits ----
  readonly STAGES = TASK_STAGES;
  readonly PRIORITIES: { value: TaskPriority; label: string }[] = [
    { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
  ];
  stageLabel = (s: TaskStage | undefined): string => TASK_STAGE_LABELS[s ?? 'created'] ?? 'Created';
  priorityLabel = (p: TaskPriority): string => PRIORITY_LABELS[p] ?? p;

  async setStage(id: string, stage: string): Promise<void> {
    try { await this.tasks.setStage(id, stage as TaskStage); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not update status'); }
  }
  async setPriority(id: string, priority: string): Promise<void> {
    try { await this.tasks.updateTask(id, { priority: priority as TaskPriority }); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not update priority'); }
  }

  // ---- Inline scalar fields ----
  /** ISO yyyy-mm-dd for a <input type="date"> value. */
  dateInput = (t?: Timestamp | null): string => t ? t.toDate().toISOString().split('T')[0] : '';

  /** Open the native date/time picker on a click anywhere in the cell. */
  openPicker(ev: Event): void {
    const el = ev.target as HTMLInputElement & { showPicker?: () => void };
    try { el.showPicker?.(); } catch { /* not user-activated / unsupported */ }
  }

  private async patch(id: string, changes: Partial<Task>): Promise<void> {
    try { await this.tasks.updateTask(id, changes); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not update the task'); }
  }
  setStart   = (id: string, v: string) => this.patch(id, { startDate: v ? Timestamp.fromDate(new Date(v)) : null });
  setDue     = (id: string, v: string) => this.patch(id, { dueDate:   v ? Timestamp.fromDate(new Date(v)) : null });
  setDueTime = (id: string, v: string) => this.patch(id, { dueTime: v || null });
  setEst     = (id: string, v: string) => this.patch(id, { estimatedHours: v === '' ? null : Number(v) });
  setTags    = (id: string, v: string) => this.patch(id, { tags: v.split(',').map(s => s.trim()).filter(Boolean) });

  // ---- Inline assignee picker ----
  readonly assignFor = signal<string | null>(null);   // task id whose picker is open
  toggleAssign(id: string): void { this.assignFor.update(v => v === id ? null : id); }
  isAssigned = (t: Task, uid: string): boolean => (t.assigneeIds ?? []).includes(uid);
  async toggleAssignee(t: Task, uid: string): Promise<void> {
    const set = new Set(t.assigneeIds ?? []);
    set.has(uid) ? set.delete(uid) : set.add(uid);
    await this.patch(t.id, { assigneeIds: [...set] });
  }

  assigneesOf(t: Task): { displayName: string; photoURL: string | null }[] {
    const s = this.space();
    if (!s) return [];
    return (t.assigneeIds ?? []).map(uid => s.memberProfiles[uid] ?? { displayName: 'Member', photoURL: null });
  }

  // ---- Collapse ----
  readonly collapsed = signal<Set<string>>(new Set());
  isCollapsed = (id: string): boolean => this.collapsed().has(id);
  toggle(id: string): void {
    this.collapsed.update(set => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ---- Startup screen ----
  readonly isStartup = computed(() => this.auth.startupSpaceId() === this.spaceId());
  readonly headerMenu = computed<MenuItem[]>(() => [
    this.isStartup()
      ? { label: 'Remove as startup screen', icon: 'x',    action: () => this.toggleStartup() }
      : { label: 'Set as startup screen',    icon: 'star', action: () => this.toggleStartup() },
  ]);
  async toggleStartup(): Promise<void> {
    try {
      if (this.isStartup()) {
        await this.auth.clearStartupSpace();
        this.toast.success('Removed as startup screen');
      } else {
        await this.auth.setStartupSpace(this.orgId(), this.spaceId());
        this.toast.success('This space now opens first on login');
      }
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not update the startup screen');
    }
  }

  // ---- Members ----
  readonly ASSIGNABLE_SPACE_ROLES = ASSIGNABLE_SPACE_ROLES;
  readonly addRole = signal<Exclude<SpaceRole, 'owner'>>('editor');
  spaceRoleLabel = (r: SpaceRole): string => SPACE_ROLE_LABELS[r] ?? r;

  async addMember(uid: string, profile: { displayName: string; photoURL: string | null }): Promise<void> {
    try {
      await this.spaces.addMember(this.spaceId(), { uid, profile }, this.addRole());
      this.toast.success(`${profile.displayName} added to the space`);
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not add the member');
    }
  }

  async changeRole(uid: string, role: string): Promise<void> {
    try {
      await this.spaces.changeRole(this.spaceId(), uid, role as SpaceRole);
      this.toast.success('Role updated');
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not update the role');
    }
  }

  async removeMember(uid: string): Promise<void> {
    if (!(await this.dialog.confirm({ title: 'Remove member', message: 'Remove this member from the space?', confirmText: 'Remove', danger: true }))) return;
    try { await this.spaces.removeMember(this.spaceId(), uid); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not remove the member'); }
  }
}
