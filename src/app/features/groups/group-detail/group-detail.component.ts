import { Component, inject, input, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { GroupService } from '@core/services/group.service';
import { NoteService } from '@core/services/note.service';
import { TaskService } from '@core/services/task.service';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';
import {
  Group, GroupInvite, GroupRole, groupMembers, ROLE_LABELS
} from '@shared/models/group.model';
import { Task } from '@shared/models/task.model';

@Component({
  selector:   'tp-group-detail',
  standalone: true,
  imports:    [RouterLink, FormsModule, IconComponent, TooltipDirective],
  templateUrl: './group-detail.component.html',
  styleUrl:    './group-detail.component.scss'
})
export class GroupDetailComponent implements OnInit, OnDestroy {
  groupId = input.required<string>();

  readonly groups = inject(GroupService);
  readonly notes  = inject(NoteService);
  readonly tasks  = inject(TaskService);
  readonly auth   = inject(AuthService);
  private readonly router = inject(Router);

  readonly ROLE_LABELS = ROLE_LABELS;
  readonly ROLE_OPTIONS: GroupRole[] = ['editor', 'viewer'];
  readonly inviteBase = `${window.location.origin}/join/`;

  // ---- Derived group state ----
  readonly group    = computed(() => this.groups.getGroupById(this.groupId()));
  readonly notFound = computed(() => !this.groups.isLoading() && !this.group());
  readonly members  = computed(() => { const g = this.group(); return g ? groupMembers(g) : []; });
  readonly canEdit  = computed(() => this.groups.canEditGroup(this.group()));
  readonly isOwner  = computed(() => this.groups.isOwner(this.group()));
  readonly myRole   = computed(() => this.groups.myRole(this.group()));

  readonly openTasks = computed(() =>
    [...this.tasks.groupTasks()].sort((a, b) => a.createdAt?.seconds - b.createdAt?.seconds)
  );

  // ---- UI state ----
  readonly showInvite   = signal(false);
  readonly inviteRole   = signal<'editor' | 'viewer'>('editor');
  readonly inviteLink   = signal<string | null>(null);
  readonly activeInvites = signal<GroupInvite[]>([]);
  readonly copied       = signal(false);

  readonly showSettings = signal(false);
  readonly editName     = signal('');
  readonly editDesc     = signal('');

  readonly newTaskTitle = signal('');
  readonly assignMenuFor = signal<string | null>(null); // taskId whose assignee menu is open

  ngOnInit(): void {
    this.notes.openGroupNotes(this.groupId());
    this.tasks.openGroupTasks(this.groupId());
  }

  ngOnDestroy(): void {
    this.notes.closeGroupNotes();
    this.tasks.closeGroupTasks();
  }

  // ---- Avatars ----
  initial = (name: string): string => (name?.charAt(0) || '?').toUpperCase();

  memberName = (uid: string): string => this.group()?.memberProfiles[uid]?.displayName ?? 'Member';
  memberPhoto = (uid: string): string | null => this.group()?.memberProfiles[uid]?.photoURL ?? null;

  // ---- Notes ----
  async newNote(): Promise<void> {
    const id = await this.notes.createNote(this.groupId());
    await this.router.navigate(['/groups', this.groupId(), 'notes', id]);
  }
  openNote(noteId: string): void {
    this.router.navigate(['/groups', this.groupId(), 'notes', noteId]);
  }
  async deleteNote(ev: Event, noteId: string): Promise<void> {
    ev.stopPropagation();
    if (!confirm('Delete this note?')) return;
    await this.notes.deleteNote(this.groupId(), noteId);
  }

  // ---- Tasks ----
  async addTask(): Promise<void> {
    const title = this.newTaskTitle().trim();
    if (!title) return;
    this.newTaskTitle.set('');
    await this.tasks.createGroupTask(this.groupId(), { title });
  }
  toggleTask(t: Task): void {
    this.tasks.updateStatus(t.id, t.status === 'completed' ? 'todo' : 'completed');
  }
  async deleteTask(t: Task): Promise<void> {
    if (!confirm('Delete this task?')) return;
    await this.tasks.deleteTask(t.id);
  }
  isAssigned = (t: Task, uid: string): boolean => (t.assigneeIds ?? []).includes(uid);
  toggleAssignee(t: Task, uid: string): void {
    const cur = new Set(t.assigneeIds ?? []);
    cur.has(uid) ? cur.delete(uid) : cur.add(uid);
    this.tasks.setAssignees(t.id, [...cur]);
  }
  toggleAssignMenu(taskId: string): void {
    this.assignMenuFor.set(this.assignMenuFor() === taskId ? null : taskId);
  }

  // ---- Invites ----
  async openInvite(): Promise<void> {
    this.inviteLink.set(null);
    this.copied.set(false);
    this.showInvite.set(true);
    await this.refreshInvites();
  }
  async generateLink(): Promise<void> {
    const g = this.group();
    if (!g) return;
    const { url } = await this.groups.createInvite(g, this.inviteRole());
    this.inviteLink.set(url);
    await this.refreshInvites();
  }
  async refreshInvites(): Promise<void> {
    const g = this.group();
    if (!g) return;
    try { this.activeInvites.set(await this.groups.listInvites(g.id)); } catch { /* non-editor */ }
  }
  async copyLink(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    } catch { /* clipboard unavailable */ }
  }
  async revoke(token: string): Promise<void> {
    await this.groups.revokeInvite(token);
    await this.refreshInvites();
  }

  // ---- Members (owner) ----
  changeRole(uid: string, role: string): void {
    this.groups.changeRole(this.groupId(), uid, role as GroupRole).catch(e => alert(e.message));
  }
  removeMember(uid: string): void {
    if (!confirm(`Remove ${this.memberName(uid)} from the group?`)) return;
    this.groups.removeMember(this.groupId(), uid).catch(e => alert(e.message));
  }

  // ---- Settings (owner) ----
  openSettings(): void {
    const g = this.group();
    if (!g) return;
    this.editName.set(g.name);
    this.editDesc.set(g.description ?? '');
    this.showSettings.set(true);
  }
  async saveSettings(): Promise<void> {
    const name = this.editName().trim();
    if (name.length < 2) return;
    await this.groups.updateGroup(this.groupId(), { name, description: this.editDesc().trim() });
    this.showSettings.set(false);
  }
  async deleteGroup(): Promise<void> {
    const g = this.group();
    if (!g || !confirm(`Delete "${g.name}"? This removes the group and its notes for everyone.`)) return;
    await this.groups.deleteGroup(g.id);
    await this.router.navigate(['/groups']);
  }
}
