import { Injectable, inject, signal, computed } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';   // date type only (no Firestore connection)
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import {
  Task, CreateTaskDto, TaskStatus, TaskPriority, TaskStage, statusForStage,
  ChecklistItem, AiExtractedTask
} from '@shared/models/task.model';
import { toTs, fromTs, nowIso } from './supabase-map.util';
import { nanoid } from '@shared/utils/id.util';
// ============================================================
// TaskService — CRUD + realtime sync via Supabase (Postgres).
// Public API unchanged from the Firestore version; internals swapped.
// ============================================================

export interface TaskFilter {
  status?:      TaskStatus[];
  priority?:    TaskPriority[];
  categoryIds?: string[];
  assigneeId?:  string;      // show only tasks assigned to this uid
  dueBefore?:   Date;
  dueAfter?:    Date;
  search?:      string;
  isOverdue?:   boolean;
  /** Only tasks due within today's local calendar day. */
  dueToday?:    boolean;
  /** Only tasks updated within the last N days. */
  updatedWithinDays?:   number;
  /** Only completed tasks whose completedAt is within the last N days. */
  completedWithinDays?: number;
}

export interface TaskSortOption {
  field:     'dueDate' | 'priority' | 'createdAt' | 'updatedAt' | 'title';
  direction: 'asc' | 'desc';
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly supa = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  // ---- State Signals ----
  // Tasks I own (user_id == me) and tasks assigned to me (assignee_ids
  // contains me) come from two queries and are merged (deduped) below.
  private readonly ownTasks      = signal<Task[]>([]);
  private readonly assignedTasks = signal<Task[]>([]);

  /** Every task visible to me: ones I own + ones assigned to me, deduped by id. */
  readonly tasks = computed<Task[]>(() => {
    const byId = new Map<string, Task>();
    for (const t of this.ownTasks())      byId.set(t.id, t);
    for (const t of this.assignedTasks()) byId.set(t.id, t);
    return [...byId.values()];
  });

  readonly isLoading   = signal(true);
  readonly error       = signal<string | null>(null);
  readonly filter      = signal<TaskFilter>({});
  readonly sort        = signal<TaskSortOption>({ field: 'dueDate', direction: 'asc' });
  readonly searchQuery = signal('');

  // ---- Derived State (pure — unchanged) ----
  readonly filteredTasks = computed(() => {
    let list = this.tasks().filter(t => !t.parentId);
    const f = this.filter();
    const q = this.searchQuery().toLowerCase();

    if (f.status?.length)     list = list.filter(t => f.status!.includes(t.status));
    if (f.priority?.length)   list = list.filter(t => f.priority!.includes(t.priority));
    if (f.categoryIds?.length) list = list.filter(t =>
      t.categoryIds.some(id => f.categoryIds!.includes(id))
    );
    if (f.assigneeId) list = list.filter(t => (t.assigneeIds ?? []).includes(f.assigneeId!));
    if (f.isOverdue) {
      const now = new Date();
      list = list.filter(t =>
        t.dueDate && t.dueDate.toDate() < now && t.status !== 'completed'
      );
    }
    if (f.dueToday) {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const startMs = start.getTime();
      list = list.filter(t => {
        if (!t.dueDate) return false;
        const d = t.dueDate.toMillis();
        return d >= startMs && d < startMs + 86_400_000;
      });
    }
    if (f.dueBefore) list = list.filter(t => t.dueDate && t.dueDate.toDate() <  f.dueBefore!);
    if (f.dueAfter)  list = list.filter(t => t.dueDate && t.dueDate.toDate() >= f.dueAfter!);
    if (f.updatedWithinDays != null) {
      const cutoff = Date.now() - f.updatedWithinDays * 86_400_000;
      list = list.filter(t => t.updatedAt && t.updatedAt.toMillis() >= cutoff);
    }
    if (f.completedWithinDays != null) {
      const cutoff = Date.now() - f.completedWithinDays * 86_400_000;
      list = list.filter(t =>
        t.status === 'completed' && t.completedAt && t.completedAt.toMillis() >= cutoff
      );
    }
    if (q) {
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      );
    }

    const { field, direction } = this.sort();
    list = [...list].sort((a, b) => {
      let aVal: number | string, bVal: number | string;
      switch (field) {
        case 'dueDate':
          aVal = a.dueDate?.seconds ?? Infinity;
          bVal = b.dueDate?.seconds ?? Infinity;
          break;
        case 'priority': {
          const order = { urgent: 0, high: 1, medium: 2, low: 3 };
          aVal = order[a.priority];
          bVal = order[b.priority];
          break;
        }
        case 'createdAt':
          aVal = a.createdAt.seconds;
          bVal = b.createdAt.seconds;
          break;
        case 'updatedAt':
          aVal = a.updatedAt?.seconds ?? 0;
          bVal = b.updatedAt?.seconds ?? 0;
          break;
        case 'title':
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        default:
          return 0;
      }
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return direction === 'asc' ? cmp : -cmp;
    });

    return list;
  });

  readonly overdueTasks  = computed(() => {
    const now = new Date();
    return this.tasks().filter(t =>
      t.dueDate && t.dueDate.toDate() < now && t.status !== 'completed'
    );
  });

  readonly todayTasks = computed(() => {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end   = new Date(start.getTime() + 86_400_000);
    return this.tasks().filter(t => {
      if (!t.dueDate) return false;
      const d = t.dueDate.toDate();
      return d >= start && d < end;
    });
  });

  readonly completionRate = computed(() => {
    const all = this.tasks().length;
    if (!all) return 0;
    const done = this.tasks().filter(t => t.status === 'completed').length;
    return Math.round((done / all) * 100);
  });

  private readonly subtasksByParent = computed(() => {
    const map = new Map<string, Task[]>();
    for (const t of this.tasks()) {
      if (!t.parentId) continue;
      const arr = map.get(t.parentId);
      if (arr) arr.push(t); else map.set(t.parentId, [t]);
    }
    return map;
  });

  // ---- Group tasks (scoped to one open group) ----
  readonly groupTasks = signal<Task[]>([]);
  private groupChannel?: RealtimeChannel;

  openGroupTasks(groupId: string): void {
    this.closeGroupTasks();
    void this.loadScoped('group_id', groupId, this.groupTasks);
    this.groupChannel = this.supa.client
      .channel(`tasks-group:${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `group_id=eq.${groupId}` },
        () => void this.loadScoped('group_id', groupId, this.groupTasks))
      .subscribe();
  }
  closeGroupTasks(): void {
    if (this.groupChannel) { void this.supa.client.removeChannel(this.groupChannel); this.groupChannel = undefined; }
    this.groupTasks.set([]);
  }

  // ---- Space tasks (scoped to one open space) ----
  readonly spaceTasks = signal<Task[]>([]);
  private spaceChannel?: RealtimeChannel;

  openSpaceTasks(spaceId: string): void {
    this.closeSpaceTasks();
    void this.loadScoped('space_id', spaceId, this.spaceTasks);
    this.spaceChannel = this.supa.client
      .channel(`tasks-space:${spaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `space_id=eq.${spaceId}` },
        () => void this.loadScoped('space_id', spaceId, this.spaceTasks))
      .subscribe();
  }
  closeSpaceTasks(): void {
    if (this.spaceChannel) { void this.supa.client.removeChannel(this.spaceChannel); this.spaceChannel = undefined; }
    this.spaceTasks.set([]);
  }

  private async loadScoped(col: 'group_id' | 'space_id', id: string, sig: { set: (t: Task[]) => void }): Promise<void> {
    const { data } = await this.supa.db('tasks').select('*').eq(col, id);
    sig.set((data ?? []).map(rowToTask));
  }

  // ---- Lifecycle ----
  private mainChannel?: RealtimeChannel;

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;
    this.isLoading.set(true);
    void this.loadMain(uid);
    // One channel; RLS limits delivered events to my visible tasks. Any change
    // reloads own + assigned (mirrors the two Firestore listeners echoing).
    this.mainChannel = this.supa.client
      .channel(`tasks-main:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => void this.loadMain(uid))
      .subscribe();
  }

  stopListening(): void {
    if (this.mainChannel) { void this.supa.client.removeChannel(this.mainChannel); this.mainChannel = undefined; }
  }

  private async loadMain(uid: string): Promise<void> {
    const [own, assigned] = await Promise.all([
      this.supa.db('tasks').select('*').eq('user_id', uid),
      this.supa.db('tasks').select('*').contains('assignee_ids', [uid]),
    ]);
    if (own.error) this.error.set(own.error.message);
    this.ownTasks.set((own.data ?? []).map(rowToTask));
    this.assignedTasks.set((assigned.data ?? []).map(rowToTask));
    this.isLoading.set(false);
  }

  // ---- CRUD ----

  async createTask(dto: Omit<CreateTaskDto, 'userId' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');
    const { data, error } = await this.supa.db('tasks').insert(taskInsertRow(dto, uid)).select('id').single();
    if (error) throw error;
    return data.id;
  }

  async createTaskFromAi(extracted: AiExtractedTask, categoryId?: string): Promise<string> {
    return this.createTask({
      title:           extracted.title,
      description:     extracted.description ?? '',
      status:          'todo',
      priority:        extracted.priority ?? 'medium',
      startDate:       extracted.startDate ? Timestamp.fromDate(new Date(extracted.startDate as any)) : null,
      dueDate:         extracted.dueDate ? Timestamp.fromDate(new Date(extracted.dueDate as any)) : null,
      dueTime:         extracted.dueTime ?? null,
      estimatedHours:  extracted.estimatedHours ?? null,
      actualHours:     null,
      categoryIds:     categoryId ? [categoryId] : [],
      tags:            extracted.tags ?? [],
      checklist:       [],
      timeBlocks:      [],
      recurrence:      null,
      isScheduled:     false,
      completedAt:     null,
      imageUrl:        null,
      reminders:       [],
      aiMetadata: {
        confidence:       extracted.confidence ?? null,
        extractionMethod: 'text' as const,
        ...(extracted.schedulingSuggestion ? { schedulingSuggestion: extracted.schedulingSuggestion } : {})
      }
    });
  }

  async updateTask(id: string, changes: Partial<Task>): Promise<void> {
    const { error } = await this.supa.db('tasks').update(taskPatch(changes)).eq('id', id);
    if (error) throw error;
  }

  /** Create a task that belongs to a group (shared + assignable to members). */
  async createGroupTask(groupId: string, data: { title: string; priority?: TaskPriority; dueDate?: Timestamp | null; assigneeIds?: string[] }): Promise<string> {
    return this.createTask({
      title:          data.title,
      description:    '',
      status:         'todo',
      priority:       data.priority ?? 'medium',
      startDate:      null,
      dueDate:        data.dueDate ?? null,
      dueTime:        null,
      estimatedHours: null,
      actualHours:    null,
      parentId:       null,
      categoryIds:    [],
      tags:           [],
      checklist:      [],
      timeBlocks:     [],
      recurrence:     null,
      isScheduled:    false,
      aiMetadata:     null,
      imageUrl:       null,
      reminders:      [],
      groupId,
      assigneeIds:    data.assigneeIds ?? []
    });
  }

  /** Create a task that belongs to a space (shared + assignable to members). */
  async createSpaceTask(spaceId: string, orgId: string, data: { title: string; priority?: TaskPriority; dueDate?: Timestamp | null; assigneeIds?: string[]; spaceGroupId?: string | null; position?: number; stage?: TaskStage; sprint?: string | null }): Promise<string> {
    const stage = data.stage ?? 'created';
    return this.createTask({
      title:          data.title,
      description:    '',
      status:         statusForStage(stage),
      stage,
      sprint:         data.sprint ?? null,
      priority:       data.priority ?? 'medium',
      startDate:      null,
      dueDate:        data.dueDate ?? null,
      dueTime:        null,
      estimatedHours: null,
      actualHours:    null,
      parentId:       null,
      categoryIds:    [],
      tags:           [],
      checklist:      [],
      timeBlocks:     [],
      recurrence:     null,
      isScheduled:    false,
      aiMetadata:     null,
      imageUrl:       null,
      reminders:      [],
      orgId,
      spaceId,
      spaceGroupId:   data.spaceGroupId ?? null,
      position:       data.position ?? 0,
      assigneeIds:    data.assigneeIds ?? []
    });
  }

  /** Move a task to a board section (and optional position). */
  async moveToGroup(taskId: string, spaceGroupId: string | null, position = 0): Promise<void> {
    await this.updateTask(taskId, { spaceGroupId, position });
  }

  /** Set the workflow stage (board Status). Derives the coarse status +
   *  completedAt so streaks/dashboards stay consistent. */
  async setStage(taskId: string, stage: TaskStage): Promise<void> {
    const status = statusForStage(stage);
    await this.updateTask(taskId, {
      stage, status,
      completedAt: status === 'completed' ? Timestamp.now() : null,
    });
  }

  /** Assign a task to a sprint (or clear it). */
  async setSprint(taskId: string, sprint: string | null): Promise<void> {
    await this.updateTask(taskId, { sprint });
  }

  async setAssignees(taskId: string, assigneeIds: string[]): Promise<void> {
    await this.updateTask(taskId, { assigneeIds });
  }

  /** Create a subtask under a parent (inherits some parent context, including
   *  its group/space scope so it stays visible in that context's listener). */
  async createSubtask(parentId: string, title: string): Promise<string> {
    const parent = this.getTaskById(parentId);
    return this.createTask({
      title,
      description:    '',
      status:         'todo',
      priority:       parent?.priority ?? 'medium',
      parentId,
      startDate:      null,
      dueDate:        parent?.dueDate ?? null,
      dueTime:        null,
      estimatedHours: null,
      actualHours:    null,
      categoryIds:    parent ? [...parent.categoryIds] : [],
      tags:           [],
      checklist:      [],
      timeBlocks:     [],
      recurrence:     null,
      isScheduled:    false,
      completedAt:    null,
      imageUrl:       null,
      reminders:      [],
      aiMetadata:     null,
      ...(parent?.groupId ? { groupId: parent.groupId } : {}),
      ...(parent?.spaceId ? { spaceId: parent.spaceId } : {}),
      ...(parent?.orgId   ? { orgId: parent.orgId }     : {}),
    });
  }

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    const changes: Partial<Task> = { status };
    if (status === 'completed') changes.completedAt = Timestamp.now();
    await this.updateTask(id, changes);
  }

  async deleteTask(id: string): Promise<void> {
    const { error } = await this.supa.db('tasks').delete().eq('id', id);
    if (error) throw error;
  }

  /** Duplicate a task (copies editable fields into a "… (copy)" task). */
  async duplicateTask(id: string): Promise<string | null> {
    const src = this.getTaskById(id);
    if (!src) return null;
    return this.createTask({
      title:          `${src.title} (copy)`,
      description:    src.description ?? '',
      status:         'todo',
      priority:       src.priority,
      startDate:      src.startDate ?? null,
      dueDate:        src.dueDate ?? null,
      dueTime:        src.dueTime ?? null,
      estimatedHours: src.estimatedHours ?? null,
      actualHours:    null,
      parentId:       src.parentId ?? null,
      categoryIds:    [...src.categoryIds],
      tags:           [...src.tags],
      checklist:      src.checklist.map(c => ({ ...c, completed: false, completedAt: null })),
      timeBlocks:     [],
      recurrence:     src.recurrence ?? null,
      isScheduled:    false,
      completedAt:    null,
      imageUrl:       src.imageUrl ?? null,
      reminders:      [],
      aiMetadata:     null,
      ...(src.groupId ? { groupId: src.groupId } : {}),
      ...(src.spaceId ? { spaceId: src.spaceId } : {}),
      ...(src.orgId   ? { orgId: src.orgId }     : {}),
      ...(src.assigneeIds ? { assigneeIds: [...src.assigneeIds] } : {}),
    });
  }

  // ---- Bulk operations (single UPDATE/DELETE with .in()) ----

  async bulkDelete(ids: string[]): Promise<void> {
    await this.supa.db('tasks').delete().in('id', ids);
  }

  async bulkUpdateStatus(ids: string[], status: TaskStatus): Promise<void> {
    await this.supa.db('tasks').update({
      status, ...(status === 'completed' ? { completed_at: nowIso() } : {})
    }).in('id', ids);
  }

  bulkComplete(ids: string[]): Promise<void> { return this.bulkUpdateStatus(ids, 'completed'); }

  async bulkRestore(ids: string[]): Promise<void> {
    await this.supa.db('tasks').update({ status: 'todo', completed_at: null }).in('id', ids);
  }

  /** Archive maps to 'cancelled' (no separate archived field; reversible via restore). */
  async bulkArchive(ids: string[]): Promise<void> {
    await this.supa.db('tasks').update({ status: 'cancelled' }).in('id', ids);
  }

  async bulkSetPriority(ids: string[], priority: TaskPriority): Promise<void> {
    await this.supa.db('tasks').update({ priority }).in('id', ids);
  }

  async bulkSetDueDate(ids: string[], dueDate: Timestamp | null): Promise<void> {
    await this.supa.db('tasks').update({ due_date: fromTs(dueDate) }).in('id', ids);
  }

  async bulkSetCategories(ids: string[], categoryIds: string[], mode: 'set' | 'add' | 'remove' = 'set'): Promise<void> {
    if (mode === 'set') {
      await this.supa.db('tasks').update({ category_ids: categoryIds }).in('id', ids);
      return;
    }
    const byId = new Map(this.tasks().map(t => [t.id, t]));
    await Promise.all(ids.map(id => {
      const current = byId.get(id)?.categoryIds ?? [];
      const next = mode === 'add'
        ? [...new Set([...current, ...categoryIds])]
        : current.filter(c => !categoryIds.includes(c));
      return this.supa.db('tasks').update({ category_ids: next }).eq('id', id);
    }));
  }

  async toggleChecklistItem(taskId: string, itemId: string): Promise<void> {
    const task = this.tasks().find(t => t.id === taskId);
    if (!task) return;
    const checklist = task.checklist.map(item =>
      item.id === itemId
        ? { ...item, completed: !item.completed, completedAt: !item.completed ? Timestamp.now() : null }
        : item
    );
    await this.updateTask(taskId, { checklist } as Partial<Task>);
  }

  addChecklistItem(taskId: string, text: string): Promise<void> {
    const task = this.tasks().find(t => t.id === taskId);
    if (!task) return Promise.resolve();
    const newItem: ChecklistItem = { id: nanoid(), text, completed: false, completedAt: null };
    return this.updateTask(taskId, { checklist: [...task.checklist, newItem] } as Partial<Task>);
  }

  // ---- Query Helpers (pure over signals — unchanged) ----

  getTaskById(id: string): Task | undefined {
    return this.tasks().find(t => t.id === id);
  }
  getSubtasks(parentId: string): Task[] {
    return this.subtasksByParent().get(parentId) ?? [];
  }
  getTasksByCategory(categoryId: string): Task[] {
    return this.tasks().filter(t => t.categoryIds.includes(categoryId));
  }
  getTasksDueInDays(days: number): Task[] {
    const now    = new Date();
    const cutoff = new Date(now.getTime() + days * 86_400_000);
    return this.tasks().filter(t =>
      t.dueDate && t.dueDate.toDate() > now && t.dueDate.toDate() <= cutoff && t.status !== 'completed'
    );
  }
}

// ============================================================
// Row <-> model mapping (snake_case columns, nested Timestamps in JSONB)
// ============================================================

function serChecklist(items: any[] | undefined) {
  return (items ?? []).map(i => ({ ...i, completedAt: fromTs(i.completedAt) }));
}
function deserChecklist(items: any[] | undefined) {
  return (items ?? []).map(i => ({ ...i, completedAt: toTs(i.completedAt) }));
}
function serTimeBlocks(tbs: any[] | undefined) {
  return (tbs ?? []).map(tb => ({ ...tb, startTime: fromTs(tb.startTime), endTime: fromTs(tb.endTime) }));
}
function deserTimeBlocks(tbs: any[] | undefined) {
  return (tbs ?? []).map(tb => ({ ...tb, startTime: toTs(tb.startTime), endTime: toTs(tb.endTime) }));
}
function serRecurrence(r: any) {
  return r ? { ...r, endsAt: fromTs(r.endsAt) } : null;
}
function deserRecurrence(r: any) {
  return r ? { ...r, endsAt: r.endsAt ? toTs(r.endsAt) : null } : null;
}

function rowToTask(r: any): Task {
  return {
    id:             r.id,
    userId:         r.user_id,
    groupId:        r.group_id ?? null,
    assigneeIds:    r.assignee_ids ?? [],
    orgId:          r.org_id ?? null,
    spaceId:        r.space_id ?? null,
    spaceGroupId:   r.space_group_id ?? null,
    position:       r.position ?? 0,
    stage:          r.stage ?? 'created',
    sprint:         r.sprint ?? null,
    customFields:   r.custom_fields ?? {},
    title:          r.title,
    description:    r.description ?? '',
    status:         r.status,
    priority:       r.priority,
    startDate:      toTs(r.start_date),
    dueDate:        toTs(r.due_date),
    dueTime:        r.due_time ?? null,
    completedAt:    toTs(r.completed_at),
    estimatedHours: r.estimated_hours ?? null,
    actualHours:    r.actual_hours ?? null,
    parentId:       r.parent_id ?? null,
    categoryIds:    r.category_ids ?? [],
    tags:           r.tags ?? [],
    checklist:      deserChecklist(r.checklist),
    timeBlocks:     deserTimeBlocks(r.time_blocks),
    recurrence:     deserRecurrence(r.recurrence),
    isScheduled:    r.is_scheduled ?? false,
    aiMetadata:     r.ai_metadata ?? null,
    imageUrl:       r.image_url ?? null,
    reminders:      r.reminders ?? [],
    createdAt:      toTs(r.created_at) as any,
    updatedAt:      toTs(r.updated_at) as any,
  };
}

function taskInsertRow(dto: any, uid: string): Record<string, unknown> {
  return {
    user_id:        uid,
    group_id:       dto.groupId ?? null,
    org_id:         dto.orgId ?? null,
    space_id:       dto.spaceId ?? null,
    space_group_id: dto.spaceGroupId ?? null,
    position:       dto.position ?? 0,
    stage:          dto.stage ?? 'created',
    sprint:         dto.sprint ?? null,
    assignee_ids:   dto.assigneeIds ?? [],
    title:          dto.title,
    description:    dto.description ?? '',
    status:         dto.status ?? 'todo',
    priority:       dto.priority ?? 'medium',
    start_date:     fromTs(dto.startDate),
    due_date:       fromTs(dto.dueDate),
    due_time:       dto.dueTime ?? null,
    completed_at:   fromTs(dto.completedAt),
    estimated_hours: dto.estimatedHours ?? null,
    actual_hours:   dto.actualHours ?? null,
    parent_id:      dto.parentId ?? null,
    category_ids:   dto.categoryIds ?? [],
    tags:           dto.tags ?? [],
    checklist:      serChecklist(dto.checklist),
    time_blocks:    serTimeBlocks(dto.timeBlocks),
    recurrence:     serRecurrence(dto.recurrence),
    is_scheduled:   dto.isScheduled ?? false,
    ai_metadata:    dto.aiMetadata ?? null,
    image_url:      dto.imageUrl ?? null,
    reminders:      dto.reminders ?? [],
  };
}

function taskPatch(c: Partial<Task>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (c.title          !== undefined) p['title'] = c.title;
  if (c.description     !== undefined) p['description'] = c.description;
  if (c.status          !== undefined) p['status'] = c.status;
  if (c.priority        !== undefined) p['priority'] = c.priority;
  if (c.startDate       !== undefined) p['start_date'] = fromTs(c.startDate);
  if (c.dueDate         !== undefined) p['due_date'] = fromTs(c.dueDate);
  if (c.dueTime         !== undefined) p['due_time'] = c.dueTime;
  if (c.completedAt     !== undefined) p['completed_at'] = fromTs(c.completedAt);
  if (c.estimatedHours  !== undefined) p['estimated_hours'] = c.estimatedHours;
  if (c.actualHours     !== undefined) p['actual_hours'] = c.actualHours;
  if (c.parentId        !== undefined) p['parent_id'] = c.parentId;
  if (c.categoryIds     !== undefined) p['category_ids'] = c.categoryIds;
  if (c.tags            !== undefined) p['tags'] = c.tags;
  if (c.checklist       !== undefined) p['checklist'] = serChecklist(c.checklist as any);
  if (c.timeBlocks      !== undefined) p['time_blocks'] = serTimeBlocks(c.timeBlocks as any);
  if (c.recurrence      !== undefined) p['recurrence'] = serRecurrence(c.recurrence);
  if (c.isScheduled     !== undefined) p['is_scheduled'] = c.isScheduled;
  if (c.aiMetadata      !== undefined) p['ai_metadata'] = c.aiMetadata;
  if (c.imageUrl        !== undefined) p['image_url'] = c.imageUrl;
  if (c.reminders       !== undefined) p['reminders'] = c.reminders;
  if (c.assigneeIds     !== undefined) p['assignee_ids'] = c.assigneeIds;
  if (c.groupId         !== undefined) p['group_id'] = c.groupId;
  if (c.spaceId         !== undefined) p['space_id'] = c.spaceId;
  if (c.spaceGroupId    !== undefined) p['space_group_id'] = c.spaceGroupId;
  if (c.position        !== undefined) p['position'] = c.position;
  if (c.stage           !== undefined) p['stage'] = c.stage;
  if (c.sprint          !== undefined) p['sprint'] = c.sprint;
  if (c.customFields    !== undefined) p['custom_fields'] = c.customFields;
  if (c.orgId           !== undefined) p['org_id'] = c.orgId;
  return p;
}
