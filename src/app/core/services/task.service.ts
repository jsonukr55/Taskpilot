import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Firestore, collection, query, where,
  onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, Timestamp, writeBatch, getDocs
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import {
  Task, CreateTaskDto, TaskStatus, TaskPriority,
  ChecklistItem, AiExtractedTask
} from '@shared/models/task.model';
// ============================================================
// TaskService — CRUD + real-time sync via Firestore
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
  private readonly firestore = inject(Firestore);
  private readonly auth      = inject(AuthService);

  // ---- State Signals ----
  // Tasks I own (userId == me) and tasks assigned to me (assigneeIds contains me)
  // come from two separate Firestore queries and are merged (deduped) below.
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

  // ---- Derived State ----
  readonly filteredTasks = computed(() => {
    // Only show root-level tasks (not subtasks) in the main list
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

    // Sort
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

  /** parentId → subtasks, built once per tasks() change. Lets getSubtasks be
   *  O(1) instead of an O(N) scan per call (the task list calls it per row). */
  private readonly subtasksByParent = computed(() => {
    const map = new Map<string, Task[]>();
    for (const t of this.tasks()) {
      if (!t.parentId) continue;
      const arr = map.get(t.parentId);
      if (arr) arr.push(t); else map.set(t.parentId, [t]);
    }
    return map;
  });

  // ---- Group tasks (separate listener, scoped to one open group) ----
  readonly groupTasks = signal<Task[]>([]);
  private groupTasksUnsub?: () => void;

  openGroupTasks(groupId: string): void {
    this.closeGroupTasks();
    const q = query(collection(this.firestore, 'tasks'), where('groupId', '==', groupId));
    this.groupTasksUnsub = onSnapshot(q, snapshot => {
      this.groupTasks.set(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
    });
  }

  closeGroupTasks(): void {
    this.groupTasksUnsub?.();
    this.groupTasksUnsub = undefined;
    this.groupTasks.set([]);
  }

  // ---- Space tasks (separate listener, scoped to one open space) ----
  readonly spaceTasks = signal<Task[]>([]);
  private spaceTasksUnsub?: () => void;

  openSpaceTasks(spaceId: string): void {
    this.closeSpaceTasks();
    const q = query(collection(this.firestore, 'tasks'), where('spaceId', '==', spaceId));
    this.spaceTasksUnsub = onSnapshot(q, snapshot => {
      this.spaceTasks.set(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
    });
  }

  closeSpaceTasks(): void {
    this.spaceTasksUnsub?.();
    this.spaceTasksUnsub = undefined;
    this.spaceTasks.set([]);
  }

  private unsubscribe?: () => void;
  private assignedUnsub?: () => void;

  // ---- Lifecycle ----

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;

    this.isLoading.set(true);

    const ownQuery = query(
      collection(this.firestore, 'tasks'),
      where('userId', '==', uid)
    );

    this.unsubscribe = onSnapshot(ownQuery, snapshot => {
      this.ownTasks.set(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
      this.isLoading.set(false);
    }, err => {
      this.error.set(err.message);
      this.isLoading.set(false);
    });

    // Tasks other people assigned to me (shared via assigneeIds).
    const assignedQuery = query(
      collection(this.firestore, 'tasks'),
      where('assigneeIds', 'array-contains', uid)
    );

    this.assignedUnsub = onSnapshot(assignedQuery, snapshot => {
      this.assignedTasks.set(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
    }, err => {
      // A missing composite index or rules gap shouldn't break the own-tasks list.
      console.error('[tasks] assigned-to-me listener failed', err);
    });
  }

  stopListening(): void {
    this.unsubscribe?.();
    this.assignedUnsub?.();
    this.unsubscribe = this.assignedUnsub = undefined;
  }

  // ---- CRUD ----

  async createTask(dto: Omit<CreateTaskDto, 'userId' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const payload = {
      ...dto,
      userId:     uid,
      status:     dto.status ?? 'todo',
      priority:   dto.priority ?? 'medium',
      categoryIds: dto.categoryIds ?? [],
      tags:       dto.tags ?? [],
      checklist:  dto.checklist ?? [],
      timeBlocks: dto.timeBlocks ?? [],
      reminders:  dto.reminders ?? [],
      isScheduled: false,
      createdAt:  serverTimestamp(),
      updatedAt:  serverTimestamp()
    };

    const ref = await addDoc(collection(this.firestore, 'tasks'), payload);
    return ref.id;
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
    const ref = doc(this.firestore, 'tasks', id);
    await updateDoc(ref, { ...changes, updatedAt: serverTimestamp() });
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
  async createSpaceTask(spaceId: string, orgId: string, data: { title: string; priority?: TaskPriority; dueDate?: Timestamp | null; assigneeIds?: string[] }): Promise<string> {
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
      orgId,
      spaceId,
      assigneeIds:    data.assigneeIds ?? []
    });
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
      // Inherit collaboration scope so the subtask lives in the same context.
      ...(parent?.groupId ? { groupId: parent.groupId } : {}),
      ...(parent?.spaceId ? { spaceId: parent.spaceId } : {}),
      ...(parent?.orgId   ? { orgId: parent.orgId }     : {}),
    });
  }

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    const changes: Partial<Task> = { status };
    if (status === 'completed') {
      (changes as Record<string, unknown>)['completedAt'] = serverTimestamp();
    }
    await this.updateTask(id, changes);
  }

  async deleteTask(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, 'tasks', id));
  }

  /**
   * Duplicate a task (copies its editable fields into a new "… (copy)" task).
   * The clone starts as 'todo' with no completion timestamp. Returns the new id.
   */
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

  async bulkDelete(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += TaskService.BATCH_LIMIT) {
      const chunk = ids.slice(i, i + TaskService.BATCH_LIMIT);
      const batch = writeBatch(this.firestore);
      chunk.forEach(id => batch.delete(doc(this.firestore, 'tasks', id)));
      await batch.commit();
    }
  }

  async bulkUpdateStatus(ids: string[], status: TaskStatus): Promise<void> {
    await this.commitInChunks(ids, id => ({
      status,
      ...(status === 'completed' ? { completedAt: serverTimestamp() } : {})
    }));
  }

  // ---- Bulk operations (multi-selection) ----
  // All batched + chunked to respect Firestore's 500-write limit. Writes
  // stay optimistic-free: the tasks listener echoes each change back into
  // the signals (usually <500ms), so the UI updates from one source of truth.

  /** Firestore batches cap at 500 writes; stay under with a safety margin. */
  private static readonly BATCH_LIMIT = 400;

  /**
   * Apply a per-id partial update to many tasks in chunked batches.
   * `build` returns the fields to set for a given id (updatedAt is added).
   */
  private async commitInChunks(
    ids: string[],
    build: (id: string) => Record<string, unknown>
  ): Promise<void> {
    for (let i = 0; i < ids.length; i += TaskService.BATCH_LIMIT) {
      const chunk = ids.slice(i, i + TaskService.BATCH_LIMIT);
      const batch = writeBatch(this.firestore);
      chunk.forEach(id =>
        batch.update(doc(this.firestore, 'tasks', id), {
          ...build(id),
          updatedAt: serverTimestamp()
        })
      );
      await batch.commit();
    }
  }

  /** Mark many tasks complete (sets completedAt). */
  bulkComplete(ids: string[]): Promise<void> {
    return this.bulkUpdateStatus(ids, 'completed');
  }

  /** Reopen many tasks back to 'todo' (clears completedAt). */
  bulkRestore(ids: string[]): Promise<void> {
    return this.commitInChunks(ids, () => ({ status: 'todo', completedAt: null }));
  }

  /**
   * Archive many tasks. The schema has no dedicated `archived` field, so
   * archiving maps to the existing `cancelled` status (reversible via
   * bulkRestore). This keeps the operation useful without a schema change.
   */
  bulkArchive(ids: string[]): Promise<void> {
    return this.commitInChunks(ids, () => ({ status: 'cancelled' }));
  }

  /** Set the same priority on many tasks. */
  bulkSetPriority(ids: string[], priority: TaskPriority): Promise<void> {
    return this.commitInChunks(ids, () => ({ priority }));
  }

  /** Set the same due date (or clear it) on many tasks. */
  bulkSetDueDate(ids: string[], dueDate: Timestamp | null): Promise<void> {
    return this.commitInChunks(ids, () => ({ dueDate }));
  }

  /**
   * Change categories on many tasks.
   *  - 'set'    → replace with `categoryIds`
   *  - 'add'    → union with existing
   *  - 'remove' → subtract from existing
   */
  bulkSetCategories(
    ids: string[],
    categoryIds: string[],
    mode: 'set' | 'add' | 'remove' = 'set'
  ): Promise<void> {
    const byId = new Map(this.tasks().map(t => [t.id, t]));
    return this.commitInChunks(ids, id => {
      if (mode === 'set') return { categoryIds };
      const current = byId.get(id)?.categoryIds ?? [];
      const next = mode === 'add'
        ? [...new Set([...current, ...categoryIds])]
        : current.filter(c => !categoryIds.includes(c));
      return { categoryIds: next };
    });
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
    const newItem: ChecklistItem = {
      id:          nanoid(),
      text,
      completed:   false,
      completedAt: null
    };
    return this.updateTask(taskId, {
      checklist: [...task.checklist, newItem]
    } as Partial<Task>);
  }

  // ---- Query Helpers ----

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
      t.dueDate &&
      t.dueDate.toDate() > now &&
      t.dueDate.toDate() <= cutoff &&
      t.status !== 'completed'
    );
  }
}

// nanoid shim — tiny unique ID generator
function nanoid(size = 21): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < size; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
