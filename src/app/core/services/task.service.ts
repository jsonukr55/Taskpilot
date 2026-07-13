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
  dueBefore?:   Date;
  dueAfter?:    Date;
  search?:      string;
  isOverdue?:   boolean;
}

export interface TaskSortOption {
  field:     'dueDate' | 'priority' | 'createdAt' | 'title';
  direction: 'asc' | 'desc';
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly firestore = inject(Firestore);
  private readonly auth      = inject(AuthService);

  // ---- State Signals ----
  readonly tasks       = signal<Task[]>([]);
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
    if (f.isOverdue) {
      const now = new Date();
      list = list.filter(t =>
        t.dueDate && t.dueDate.toDate() < now && t.status !== 'completed'
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

  private unsubscribe?: () => void;

  // ---- Lifecycle ----

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;

    this.isLoading.set(true);

    const q = query(
      collection(this.firestore, 'tasks'),
      where('userId', '==', uid)
    );

    this.unsubscribe = onSnapshot(q, snapshot => {
      const tasks = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      } as Task));
      this.tasks.set(tasks);
      this.isLoading.set(false);
    }, err => {
      this.error.set(err.message);
      this.isLoading.set(false);
    });
  }

  stopListening(): void {
    this.unsubscribe?.();
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

  async setAssignees(taskId: string, assigneeIds: string[]): Promise<void> {
    await this.updateTask(taskId, { assigneeIds });
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

  async bulkDelete(ids: string[]): Promise<void> {
    const batch = writeBatch(this.firestore);
    ids.forEach(id => batch.delete(doc(this.firestore, 'tasks', id)));
    await batch.commit();
  }

  async bulkUpdateStatus(ids: string[], status: TaskStatus): Promise<void> {
    const batch = writeBatch(this.firestore);
    ids.forEach(id =>
      batch.update(doc(this.firestore, 'tasks', id), {
        status,
        updatedAt: serverTimestamp(),
        ...(status === 'completed' ? { completedAt: serverTimestamp() } : {})
      })
    );
    await batch.commit();
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
    return this.tasks().filter(t => t.parentId === parentId);
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
