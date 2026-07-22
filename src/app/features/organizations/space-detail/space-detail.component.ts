import { Component, inject, input, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SpaceService } from '@core/services/space.service';
import { OrganizationService } from '@core/services/organization.service';
import { TaskService } from '@core/services/task.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TaskCardComponent } from '@shared/components/task-card/task-card.component';
import { TaskDrawerComponent } from '@shared/components/task-drawer/task-drawer.component';
import { spaceMembers, SpaceRole } from '@shared/models/space.model';
import { Task } from '@shared/models/task.model';

@Component({
  selector:   'tp-space-detail',
  standalone: true,
  imports:    [RouterLink, FormsModule, IconComponent, TaskCardComponent, TaskDrawerComponent],
  templateUrl: './space-detail.component.html',
  styleUrl:    './space-detail.component.scss'
})
export class SpaceDetailComponent implements OnInit, OnDestroy {
  orgId   = input.required<string>();
  spaceId = input.required<string>();

  readonly spaces = inject(SpaceService);
  readonly orgs   = inject(OrganizationService);
  readonly tasks  = inject(TaskService);
  readonly auth   = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly space    = computed(() => this.spaces.getSpaceById(this.spaceId()));
  readonly notFound = computed(() => !this.spaces.isLoading() && !this.space());
  readonly members  = computed(() => { const s = this.space(); return s ? spaceMembers(s) : []; });
  readonly canEdit  = computed(() => this.spaces.canEditSpace(this.space()));
  readonly isOwner  = computed(() => this.spaces.isSpaceOwner(this.space()));

  /** Root tasks in this space (subtasks render inside the drawer). */
  readonly rootTasks = computed(() =>
    this.tasks.spaceTasks()
      .filter(t => !t.parentId)
      .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))
  );

  readonly newTaskTitle = signal('');
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
  }
  ngOnDestroy(): void {
    this.tasks.closeSpaceTasks();
  }

  initial = (name: string): string => (name?.charAt(0) || '?').toUpperCase();

  async addTask(): Promise<void> {
    const title = this.newTaskTitle().trim();
    if (!title) return;
    this.newTaskTitle.set('');
    try {
      await this.tasks.createSpaceTask(this.spaceId(), this.orgId(), { title });
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not create the task');
    }
  }

  async addMember(uid: string, profile: { displayName: string; photoURL: string | null }, role: SpaceRole = 'editor'): Promise<void> {
    try {
      await this.spaces.addMember(this.spaceId(), { uid, profile }, role);
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
