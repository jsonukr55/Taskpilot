import { Component, inject, signal, computed, effect } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/services/auth.service';
import { AdminService, AdminUser, TaskLite, SpaceLite, GlobalRole, ArchivedTask } from '@core/services/admin.service';
import { OrganizationService } from '@core/services/organization.service';
import { ClientService } from '@core/services/client.service';
import { ToastService } from '@core/services/toast.service';
import { DialogService } from '@core/services/dialog.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { MenuComponent, MenuItem } from '@shared/components/menu/menu.component';
import { AvatarPickerComponent } from '@shared/components/avatar-picker/avatar-picker.component';
import { EntityAvatarComponent } from '@shared/components/entity-avatar/entity-avatar.component';
import { SelectComponent, SelectOption } from '@shared/components/select/select.component';
import { LogoService } from '@core/services/logo.service';
import { Client } from '@shared/models/client.model';
import { TASK_STAGE_LABELS } from '@shared/models/task.model';
import { formatBytes } from '@shared/models/task-attachment.model';
import { Organization, OrgRole, ASSIGNABLE_ORG_ROLES, ORG_ROLE_LABELS } from '@shared/models/organization.model';

/** Default avatar for a new client; the full library lives in the picker. */
const CLIENT_ICONS = ['🏢'];
const CLIENT_COLORS = ['#6366f1','#10b981','#f59e0b','#f43f5e','#8b5cf6','#0ea5e9','#ec4899','#14b8a6'];

/** A person shown in the admin user list, with their org memberships in the current scope. */
export interface ScopeUser {
  uid: string;
  displayName: string;
  photoURL: string | null;
  email: string;
  globalRole: GlobalRole;
  memberships: { orgId: string; orgName: string; role: OrgRole }[];
}

// ============================================================
// AdminComponent — the /admin panel.
//   • Global (platform) admins: manage clients, orgs, and every
//     client's users (org access + role + platform-admin), plus
//     platform-wide tasks/data footprint.
//   • Org owners/admins (not global): an org-scoped panel to manage
//     the members of the orgs they administer.
// Content is gated in-component (not by a route guard) so the very
// first "bootstrap" admin can reach this page and self-promote.
// ============================================================
@Component({
  selector:   'tp-admin',
  standalone: true,
  imports:    [NgTemplateOutlet, RouterLink, FormsModule, IconComponent, MenuComponent,
               AvatarPickerComponent, EntityAvatarComponent, SelectComponent],
  templateUrl: './admin.component.html',
  styleUrl:    './admin.component.scss'
})
export class AdminComponent {
  readonly auth    = inject(AuthService);
  readonly orgs    = inject(OrganizationService);
  readonly clients = inject(ClientService);
  private readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);
  private readonly logos = inject(LogoService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);

  readonly CLIENT_COLORS = CLIENT_COLORS;
  readonly ASSIGNABLE_ORG_ROLES = ASSIGNABLE_ORG_ROLES;
  readonly ORG_ROLE_LABELS = ORG_ROLE_LABELS;
  /** Role choices for the per-org access picker (tp-select). */
  readonly orgRoleOptions: SelectOption[] = ASSIGNABLE_ORG_ROLES.map(r => ({ value: r, label: ORG_ROLE_LABELS[r] }));

  // ---- Platform data (loaded when a global admin opens the panel) ----
  readonly users  = signal<AdminUser[]>([]);
  readonly tasks  = signal<TaskLite[]>([]);
  readonly spaces = signal<SpaceLite[]>([]);
  readonly attachments = signal<{ clientId: string | null; size: number }[]>([]);
  readonly archived    = signal<ArchivedTask[]>([]);
  readonly loadingData = signal(false);

  readonly totalStorage = computed(() => formatBytes(this.attachments().reduce((s, a) => s + a.size, 0)));
  fmt = formatBytes;

  // ---- Which panel to show ----
  /** Orgs the current (non-global) user owns or admins. */
  readonly myAdminOrgs = computed(() => {
    const uid = this.auth.userId();
    return this.orgs.organizations().filter(o => o.ownerId === uid || o.roles[uid ?? ''] === 'admin');
  });
  readonly canOrgAdmin = computed(() => this.myAdminOrgs().length > 0);

  // ---- Client-scoped user management (global admin) ----
  readonly selectedClientId = signal<string | null>(null);
  readonly effectiveClientId = computed(() => this.selectedClientId() ?? this.clients.clients()[0]?.id ?? null);
  readonly selectedClient = computed(() => this.clients.clients().find(c => c.id === this.effectiveClientId()) ?? null);

  /** Orgs in the current scope: the selected client's orgs (global) or the user's admin orgs (org-scope). */
  readonly scopeOrgs = computed<Organization[]>(() => {
    if (this.auth.isAdmin()) {
      const cid = this.effectiveClientId();
      return cid ? this.orgs.orgsInClient(cid) : [];
    }
    return this.myAdminOrgs();
  });

  /** Scope orgs as tp-select options for the "add user to org" picker. */
  readonly orgOptions = computed<SelectOption[]>(() =>
    this.scopeOrgs().map(o => ({ value: o.id, label: o.name, icon: o.icon, color: o.color })));

  private readonly usersByUid = computed(() => {
    const m = new Map<string, AdminUser>();
    for (const u of this.users()) m.set(u.id, u);
    return m;
  });

  /** Distinct users across the scope's orgs, with their memberships. */
  readonly scopeUsers = computed<ScopeUser[]>(() => {
    const byUid = new Map<string, ScopeUser>();
    const profiles = this.usersByUid();
    for (const o of this.scopeOrgs()) {
      for (const uid of o.memberIds) {
        let su = byUid.get(uid);
        if (!su) {
          const prof = profiles.get(uid);
          const mp = o.memberProfiles[uid];
          su = {
            uid,
            displayName: mp?.displayName ?? prof?.displayName ?? 'User',
            photoURL:    mp?.photoURL ?? prof?.photoURL ?? null,
            email:       prof?.email ?? '',
            globalRole:  prof?.globalRole ?? null,
            memberships: [],
          };
          byUid.set(uid, su);
        }
        su.memberships.push({ orgId: o.id, orgName: o.name, role: o.roles[uid] ?? 'member' });
      }
    }
    return [...byUid.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  });

  // Inline "Manage org access" panel (which user's panel is open)
  readonly manageUid   = signal<string | null>(null);

  // Add-user-to-org (by email)
  readonly addEmail = signal('');
  readonly addOrgId = signal<string | null>(null);
  readonly adding   = signal(false);

  readonly stats = computed(() => {
    const t = this.tasks();
    const byStage: Record<string, number> = {};
    for (const x of t) byStage[x.stage] = (byStage[x.stage] ?? 0) + 1;
    return {
      total: t.length,
      roots: t.filter(x => !x.parentId).length,
      subs:  t.filter(x => x.parentId).length,
      byStage: Object.entries(byStage).map(([stage, n]) => ({ label: TASK_STAGE_LABELS[stage as keyof typeof TASK_STAGE_LABELS] ?? stage, n })),
    };
  });

  /** Per-client data footprint (orgs / spaces / tasks / storage). */
  readonly footprint = computed(() => {
    const orgs = this.orgs.organizations();
    const spaces = this.spaces();
    const tasks = this.tasks();
    const atts = this.attachments();
    return this.clients.clients().map(c => ({
      client: c,
      orgs:   orgs.filter(o => o.clientId === c.id).length,
      spaces: spaces.filter(s => s.clientId === c.id).length,
      tasks:  tasks.filter(t => t.clientId === c.id).length,
      storage: formatBytes(atts.filter(a => a.clientId === c.id).reduce((s, a) => s + a.size, 0)),
    }));
  });

  private loaded = false;

  constructor() {
    // Load platform data once the user is (or becomes) platform staff.
    // allowSignalWrites: loadData writes signals; `loaded` guards against the
    // reload loop (the effect also tracks loadingData via loadData's guard read).
    effect(() => {
      if (this.auth.isAdmin() && !this.loaded) {
        this.loaded = true;
        void this.loadData();
      }
    }, { allowSignalWrites: true });
    // Keep the "add to org" selector pointed at a valid scope org.
    effect(() => {
      const orgs = this.scopeOrgs();
      const cur = this.addOrgId();
      if (!orgs.some(o => o.id === cur)) this.addOrgId.set(orgs[0]?.id ?? null);
    }, { allowSignalWrites: true });
  }

  /** Load platform data. Each read is independent (allSettled) so one failing
   *  query (e.g. attachments) never blanks the others (e.g. users → emails). */
  private async loadData(): Promise<void> {
    if (this.loadingData()) return;
    this.loadingData.set(true);
    const [users, tasks, spaces, attachments, archived] = await Promise.allSettled([
      this.admin.allUsers(), this.admin.allTasks(), this.admin.allSpaces(), this.admin.allAttachments(), this.admin.allArchivedTasks(),
    ]);
    if (users.status === 'fulfilled')       this.users.set(users.value);
    if (tasks.status === 'fulfilled')       this.tasks.set(tasks.value);
    if (spaces.status === 'fulfilled')      this.spaces.set(spaces.value);
    if (attachments.status === 'fulfilled') this.attachments.set(attachments.value);
    if (archived.status === 'fulfilled')    this.archived.set(archived.value);
    const failed = [users, tasks, spaces, attachments, archived].find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) this.toast.error(this.msg(failed.reason) || 'Some platform data could not be loaded');
    this.loadingData.set(false);
  }

  // ---- User list interactions ----

  selectClient(id: string): void {
    this.selectedClientId.set(id);
    this.manageUid.set(null);
  }

  openManage(uid: string): void {
    this.manageUid.update(v => v === uid ? null : uid);
  }

  /** Actions for a user row's ⋯ menu (uses the shared tp-menu).
   *  Platform-role actions only in the global panel; org-scoped shows just access. */
  userMenu(u: ScopeUser, platform: boolean): MenuItem[] {
    const items: MenuItem[] = [];
    if (platform && this.canActOnRole(u)) {
      for (const c of this.roleChoices(u)) {
        items.push({ label: c.label, icon: 'shield', action: () => void this.setUserRole(u, c.role) });
      }
    }
    items.push({ label: 'Manage org access', icon: 'grid', action: () => this.openManage(u.uid) });
    return items;
  }

  membershipIn(u: ScopeUser, orgId: string): { orgId: string; orgName: string; role: OrgRole } | undefined {
    return u.memberships.find(m => m.orgId === orgId);
  }

  userInitial = (u: { displayName?: string; email?: string }): string =>
    (u.displayName?.charAt(0) || u.email?.charAt(0) || '?').toUpperCase();

  /** Add or remove a user from one org in the scope. */
  async toggleOrgAccess(u: ScopeUser, org: Organization): Promise<void> {
    const isMember = !!this.membershipIn(u, org.id);
    try {
      if (isMember) {
        if (org.ownerId === u.uid) { this.toast.error("The owner can't be removed from their org."); return; }
        await this.orgs.removeMember(org.id, u.uid);
        this.toast.success(`Removed from ${org.name}`);
      } else {
        if (!u.email) { this.toast.error('This user has no email on file — add them from the org page.'); return; }
        await this.orgs.addMemberByEmail(org.id, u.email);
        this.toast.success(`Added to ${org.name}`);
      }
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not update org access');
    }
  }

  async setOrgRole(u: ScopeUser, org: Organization, role: OrgRole): Promise<void> {
    try {
      await this.orgs.changeRole(org.id, u.uid, role);
      this.toast.success(`${u.displayName} is now ${ORG_ROLE_LABELS[role]} in ${org.name}`);
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not change the role');
    }
  }

  /** Human label for a platform role. */
  platformRoleLabel(role: GlobalRole): string {
    return role === 'admin' ? 'Owner' : role === 'superglobal' ? 'Superglobal' : 'No platform role';
  }

  /** Can the current viewer change this user's platform role?
   *  Owners can act on anyone; Superglobals can't touch an Owner. */
  canActOnRole(u: ScopeUser): boolean {
    return this.auth.isOwner() || u.globalRole !== 'admin';
  }

  /** Platform-role choices the viewer may assign to this user (minus the current). */
  roleChoices(u: ScopeUser): { label: string; role: GlobalRole }[] {
    const choices: { label: string; role: GlobalRole }[] = [];
    if (this.auth.isOwner()) choices.push({ label: 'Make Owner', role: 'admin' });
    choices.push({ label: 'Make Superglobal', role: 'superglobal' });
    choices.push({ label: 'Remove platform role', role: null });
    return choices.filter(c => c.role !== u.globalRole);
  }

  async setUserRole(u: ScopeUser, role: GlobalRole): Promise<void> {
    if (role === null && !(await this.dialog.confirm({
      title: 'Remove platform role',
      message: `Remove platform access from ${u.displayName}?`, confirmText: 'Remove', danger: true,
    }))) return;
    this.working.set(true);
    try {
      await this.admin.setGlobalRole({ uid: u.uid, email: u.email || undefined }, role);
      this.users.update(list => list.map(x => x.id === u.uid ? { ...x, globalRole: role } : x));
      if (u.uid === this.auth.userId()) await this.auth.reloadProfile();
      this.toast.success(role === null
        ? `${u.email} no longer has platform access`
        : `${u.email} is now ${this.platformRoleLabel(role)}`);
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not update the role');
    } finally {
      this.working.set(false);
    }
  }

  async addUser(): Promise<void> {
    const email = this.addEmail().trim();
    const orgId = this.addOrgId();
    if (!email || !orgId) return;
    this.adding.set(true);
    try {
      await this.orgs.addMemberByEmail(orgId, email);
      this.addEmail.set('');
      const org = this.orgs.getOrgById(orgId);
      this.toast.success(`Added to ${org?.name ?? 'organization'}`);
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not add that user (they must have a TaskPilot account)');
    } finally {
      this.adding.set(false);
    }
  }

  // ---- Create-client form ----
  readonly showClientForm  = signal(false);
  readonly newClientName   = signal('');
  readonly newClientDesc   = signal('');
  readonly newClientIcon   = signal(CLIENT_ICONS[0]);
  readonly newClientColor  = signal(CLIENT_COLORS[0]);
  readonly creatingClient  = signal(false);
  /** Chosen logo, held until the client exists — see IconPickerComponent. */
  readonly pendingClientLogo = signal<File | null>(null);

  // Bootstrap (non-admin self-promote)
  readonly claiming = signal(false);
  readonly working  = signal(false);

  orgCount = (clientId: string): number => this.orgs.orgsInClient(clientId).length;

  /** Row actions for a client (⋯ menu) — clearer than bare +/trash icons. */
  clientMenu(c: Client): MenuItem[] {
    const items: MenuItem[] = [
      { label: 'New organization', icon: 'plus',
        action: () => void this.router.navigate(['/organizations'], { queryParams: { new: true, client: c.id } }) },
    ];
    if (this.auth.isOwner()) {
      items.push({ label: 'Delete client', icon: 'trash-2', danger: true, action: () => void this.deleteClient(c) });
    }
    return items;
  }

  startCreateClient(): void {
    this.newClientName.set('');
    this.newClientDesc.set('');
    this.newClientIcon.set(CLIENT_ICONS[0]);
    this.newClientColor.set(CLIENT_COLORS[0]);
    this.pendingClientLogo.set(null);
    this.showClientForm.set(true);
  }

  async createClient(): Promise<void> {
    const name = this.newClientName().trim();
    if (name.length < 2) return;
    this.creatingClient.set(true);
    try {
      const id = await this.clients.createClient({
        name,
        description: this.newClientDesc().trim(),
        icon:  this.newClientIcon(),
        color: this.newClientColor(),
      });

      // Storage RLS checks the client exists before allowing the write, so an
      // uploaded logo can only be stored once the row is in place.
      const file = this.pendingClientLogo();
      if (file) {
        try {
          const iconUrl = await this.logos.upload('clients', id, file);
          await this.clients.updateClient(id, { iconUrl });
        } catch {
          this.toast.error('Client created, but the logo failed to upload.');
        }
      }

      this.showClientForm.set(false);
      this.toast.success('Client created');
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not create the client');
    } finally {
      this.creatingClient.set(false);
    }
  }

  async deleteClient(c: Client): Promise<void> {
    const orgs = this.orgCount(c.id);
    const warning = orgs > 0
      ? `Delete "${c.name}"? This also deletes its ${orgs} organization${orgs === 1 ? '' : 's'} and all their spaces and tasks.`
      : `Delete "${c.name}"?`;
    if (!(await this.dialog.confirm({ title: 'Delete client', message: warning, confirmText: 'Delete', danger: true }))) return;
    try {
      await this.clients.deleteClient(c.id);
      this.toast.success('Client deleted');
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not delete the client');
    }
  }

  async claimBootstrap(): Promise<void> {
    this.claiming.set(true);
    try {
      await this.admin.claimBootstrapAdmin();
      await this.auth.reloadProfile();
      this.toast.success('You are now an admin');
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Not authorized to claim admin access');
    } finally {
      this.claiming.set(false);
    }
  }

  // ---- Archive (soft-deleted tasks; purged after 30 days) ----
  clientName(clientId: string | null): string {
    return clientId ? (this.clients.getClientById(clientId)?.name ?? '—') : '—';
  }

  async restoreArchived(t: ArchivedTask): Promise<void> {
    try {
      await this.admin.restoreTask(t.id);
      this.archived.update(list => list.filter(x => x.id !== t.id));
      this.toast.success(`Restored "${t.title}"`);
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not restore the task');
    }
  }

  async purgeArchived(t: ArchivedTask): Promise<void> {
    if (!(await this.dialog.confirm({ title: 'Delete permanently', message: `Permanently delete "${t.title}"? This cannot be undone.`, confirmText: 'Delete forever', danger: true }))) return;
    try {
      await this.admin.purgeTask(t.id);
      this.archived.update(list => list.filter(x => x.id !== t.id));
      this.toast.success('Permanently deleted');
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not delete the task');
    }
  }

  private msg(e: any): string {
    return e?.error?.error ?? e?.message ?? '';
  }
}
