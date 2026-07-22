import { Component, inject, input, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
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
import { Task, TaskStatus, TaskPriority } from '@shared/models/task.model';

interface BoardSection { group: SpaceGroup; tasks: Task[]; }

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do', in_progress: 'In Progress', completed: 'Done', cancelled: 'Cancelled',
};
const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};

@Component({
  selector:   'tp-space-detail',
  standalone: true,
  imports:    [RouterLink, FormsModule, DatePipe, NgTemplateOutlet, IconComponent, TooltipDirective, TaskDrawerComponent],
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

  // ---- Board: sections (Groups) + their tasks ----
  readonly board = computed<{ sections: BoardSection[]; ungrouped: Task[] }>(() => {
    const groups = this.spaceGroups.groups();
    const byGroup = new Map<string, Task[]>();
    groups.forEach(g => byGroup.set(g.id, []));
    const ungrouped: Task[] = [];
    for (const t of this.rootTasks()) {
      const bucket = t.spaceGroupId && byGroup.has(t.spaceGroupId) ? byGroup.get(t.spaceGroupId)! : ungrouped;
      bucket.push(t);
    }
    const byPos = (a: Task, b: Task) => (a.position ?? 0) - (b.position ?? 0);
    byGroup.forEach(list => list.sort(byPos));
    ungrouped.sort(byPos);
    return { sections: groups.map(g => ({ group: g, tasks: byGroup.get(g.id) ?? [] })), ungrouped };
  });

  /** Options for the "move to section" dropdown on each task. */
  readonly sectionOptions = computed(() => this.spaceGroups.groups().map(g => ({ id: g.id, name: g.name })));

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

  async addTaskToGroup(groupId: string | null, input: HTMLInputElement): Promise<void> {
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    const list = groupId
      ? (this.board().sections.find(s => s.group.id === groupId)?.tasks ?? [])
      : this.board().ungrouped;
    try {
      await this.tasks.createSpaceTask(this.spaceId(), this.orgId(), {
        title, spaceGroupId: groupId, position: list.length,
      });
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not create the task');
    }
  }

  async moveTask(taskId: string, groupId: string): Promise<void> {
    const gid = groupId || null;
    const target = gid
      ? (this.board().sections.find(s => s.group.id === gid)?.tasks ?? [])
      : this.board().ungrouped;
    try { await this.tasks.moveToGroup(taskId, gid, target.length); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not move the task'); }
  }

  // ---- Inline cell edits ----
  readonly STATUSES: { value: TaskStatus; label: string }[] = [
    { value: 'todo', label: 'To Do' }, { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Done' }, { value: 'cancelled', label: 'Cancelled' },
  ];
  readonly PRIORITIES: { value: TaskPriority; label: string }[] = [
    { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
  ];
  statusLabel = (s: TaskStatus): string => STATUS_LABELS[s] ?? s;
  priorityLabel = (p: TaskPriority): string => PRIORITY_LABELS[p] ?? p;

  async setStatus(id: string, status: string): Promise<void> {
    try { await this.tasks.updateStatus(id, status as TaskStatus); }
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
