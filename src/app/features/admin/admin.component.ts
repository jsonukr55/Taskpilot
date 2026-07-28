import { Component, inject, signal, computed, effect } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/services/auth.service';
import { AdminService, AdminUser, TaskLite, SpaceLite, GlobalRole } from '@core/services/admin.service';
import { OrganizationService } from '@core/services/organization.service';
import { ClientService } from '@core/services/client.service';
import { ToastService } from '@core/services/toast.service';
import { DialogService } from '@core/services/dialog.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { Client } from '@shared/models/client.model';
import { TASK_STAGE_LABELS } from '@shared/models/task.model';
import { formatBytes } from '@shared/models/task-attachment.model';
import { Organization, OrgRole, ASSIGNABLE_ORG_ROLES, ORG_ROLE_LABELS } from '@shared/models/organization.model';

const CLIENT_ICONS  = ['🏢','🏦','🏪','🏭','🌐','💼','🚀','🧩','🛰️','🎯','📦','⚙️'];
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
  imports:    [NgTemplateOutlet, RouterLink, FormsModule, IconComponent],
  templateUrl: './admin.component.html',
  styleUrl:    './admin.component.scss'
})
export class AdminComponent {
  readonly auth    = inject(AuthService);
  readonly orgs    = inject(OrganizationService);
  readonly clients = inject(ClientService);
  private readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly CLIENT_ICONS  = CLIENT_ICONS;
  readonly CLIENT_COLORS = CLIENT_COLORS;
  readonly ASSIGNABLE_ORG_ROLES = ASSIGNABLE_ORG_ROLES;
  readonly ORG_ROLE_LABELS = ORG_ROLE_LABELS;

  // ---- Platform data (loaded when a global admin opens the panel) ----
  readonly users  = signal<AdminUser[]>([]);
  readonly tasks  = signal<TaskLite[]>([]);
  readonly spaces = signal<SpaceLite[]>([]);
  readonly attachments = signal<{ clientId: string | null; size: number }[]>([]);
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

  // Row menus / inline panels
  readonly openMenuUid = signal<string | null>(null);
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

  constructor() {
    // Load platform data once the user is (or becomes) a global admin.
    effect(() => { if (this.auth.isAdmin()) this.loadData(); });
    // Keep the "add to org" selector pointed at a valid scope org.
    effect(() => {
      const orgs = this.scopeOrgs();
      const cur = this.addOrgId();
      if (!orgs.some(o => o.id === cur)) this.addOrgId.set(orgs[0]?.id ?? null);
    });
  }

  private async loadData(): Promise<void> {
    if (this.loadingData()) return;
    this.loadingData.set(true);
    try {
      const [users, tasks, spaces, attachments] = await Promise.all([
        this.admin.allUsers(), this.admin.allTasks(), this.admin.allSpaces(), this.admin.allAttachments(),
      ]);
      this.users.set(users); this.tasks.set(tasks); this.spaces.set(spaces); this.attachments.set(attachments);
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not load platform data');
    } finally {
      this.loadingData.set(false);
    }
  }

  // ---- User list interactions ----

  selectClient(id: string): void {
    this.selectedClientId.set(id);
    this.closeMenus();
  }

  toggleMenu(uid: string): void {
    this.openMenuUid.update(v => v === uid ? null : uid);
    this.manageUid.set(null);
  }

  openManage(uid: string): void {
    this.manageUid.update(v => v === uid ? null : uid);
    this.openMenuUid.set(null);
  }

  closeMenus(): void {
    this.openMenuUid.set(null);
    this.manageUid.set(null);
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

  async removeFromScope(u: ScopeUser): Promise<void> {
    const orgs = u.memberships.filter(m => this.scopeOrgs().some(o => o.id === m.orgId));
    const scopeLabel = this.auth.isAdmin() ? (this.selectedClient()?.name ?? 'this client') : 'your organizations';
    if (!(await this.dialog.confirm({
      title: 'Remove user',
      message: `Remove ${u.displayName} from all of ${scopeLabel}? They lose access to ${orgs.length} organization${orgs.length === 1 ? '' : 's'}.`,
      confirmText: 'Remove', danger: true,
    }))) return;
    this.closeMenus();
    try {
      for (const m of orgs) {
        const org = this.orgs.getOrgById(m.orgId);
        if (org?.ownerId === u.uid) continue; // never remove an owner
        await this.orgs.removeMember(m.orgId, u.uid);
      }
      this.toast.success(`${u.displayName} removed`);
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not remove the user');
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
    this.closeMenus();
    if (!u.email) { this.toast.error('This user has no email on file.'); return; }
    if (role === null && !(await this.dialog.confirm({
      title: 'Remove platform role',
      message: `Remove platform access from ${u.email}?`, confirmText: 'Remove', danger: true,
    }))) return;
    this.working.set(true);
    try {
      await this.admin.setGlobalRole(u.email, role);
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

  // Bootstrap (non-admin self-promote)
  readonly claiming = signal(false);
  readonly working  = signal(false);

  orgCount = (clientId: string): number => this.orgs.orgsInClient(clientId).length;

  startCreateClient(): void {
    this.newClientName.set('');
    this.newClientDesc.set('');
    this.newClientIcon.set(CLIENT_ICONS[0]);
    this.newClientColor.set(CLIENT_COLORS[0]);
    this.showClientForm.set(true);
  }

  async createClient(): Promise<void> {
    const name = this.newClientName().trim();
    if (name.length < 2) return;
    this.creatingClient.set(true);
    try {
      await this.clients.createClient({
        name,
        description: this.newClientDesc().trim(),
        icon:  this.newClientIcon(),
        color: this.newClientColor(),
      });
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

  private msg(e: any): string {
    return e?.error?.error ?? e?.message ?? '';
  }
}
