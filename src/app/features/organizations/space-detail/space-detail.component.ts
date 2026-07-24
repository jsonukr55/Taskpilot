import { Component, inject, input, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { SpaceService } from '@core/services/space.service';
import { SpaceGroupService } from '@core/services/space-group.service';
import { OrganizationService } from '@core/services/organization.service';
import { TaskService } from '@core/services/task.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';
import { TaskDrawerComponent } from '@shared/components/task-drawer/task-drawer.component';
import { spaceMembers } from '@shared/models/space.model';
import { SpaceGroup } from '@shared/models/space-group.model';
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
  imports:    [RouterLink, FormsModule, DatePipe, NgTemplateOutlet, DragDropModule, IconComponent, TooltipDirective, TaskDrawerComponent],
  templateUrl: './space-detail.component.html',
  styleUrl:    './space-detail.component.scss'
})
export class SpaceDetailComponent implements OnInit, OnDestroy {
  orgId   = input.required<string>();
  spaceId = input.required<string>();

  readonly spaces      = inject(SpaceService);
  readonly spaceGroups = inject(SpaceGroupService);
  readonly orgs        = inject(OrganizationService);
  readonly tasks       = inject(TaskService);
  readonly auth        = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly space    = computed(() => this.spaces.getSpaceById(this.spaceId()));
  readonly notFound = computed(() => !this.spaces.isLoading() && !this.space());
  readonly members  = computed(() => { const s = this.space(); return s ? spaceMembers(s) : []; });
  readonly canEdit  = computed(() => this.spaces.canEditSpace(this.space()));
  readonly isOwner  = computed(() => this.spaces.isSpaceOwner(this.space()));

  /** Root tasks in this space (subtasks render inside the drawer). */
  readonly rootTasks = computed(() =>
    this.tasks.spaceTasks().filter(t => !t.parentId)
  );

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

  readonly showAddMember = signal(false);

  ngOnInit(): void {
    this.tasks.openSpaceTasks(this.spaceId());
    this.spaceGroups.open(this.spaceId());
    try {
      const saved = localStorage.getItem('space-view:' + this.spaceId());
      if (saved === 'section' || saved === 'status' || saved === 'sprint') this.view.set(saved);
    } catch { /* ignore */ }
  }
  ngOnDestroy(): void {
    this.tasks.closeSpaceTasks();
    this.spaceGroups.close();
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
    if (!confirm(`Delete section "${g.name}"? Its tasks stay in the space but become ungrouped.`)) return;
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

  // ---- Members ----

  async addMember(uid: string, profile: { displayName: string; photoURL: string | null }): Promise<void> {
    try {
      await this.spaces.addMember(this.spaceId(), { uid, profile }, 'editor');
      this.toast.success(`${profile.displayName} added to the space`);
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not add the member');
    }
  }

  async removeMember(uid: string): Promise<void> {
    if (!confirm('Remove this member from the space?')) return;
    try { await this.spaces.removeMember(this.spaceId(), uid); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not remove the member'); }
  }
}
