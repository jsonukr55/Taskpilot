import { Component, inject, signal, computed, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/services/auth.service';
import { AdminService, AdminUser, TaskLite, SpaceLite } from '@core/services/admin.service';
import { OrganizationService } from '@core/services/organization.service';
import { ClientService } from '@core/services/client.service';
import { ToastService } from '@core/services/toast.service';
import { DialogService } from '@core/services/dialog.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { Client } from '@shared/models/client.model';
import { TASK_STAGE_LABELS } from '@shared/models/task.model';

const CLIENT_ICONS  = ['🏢','🏦','🏪','🏭','🌐','💼','🚀','🧩','🛰️','🎯','📦','⚙️'];
const CLIENT_COLORS = ['#6366f1','#10b981','#f59e0b','#f43f5e','#8b5cf6','#0ea5e9','#ec4899','#14b8a6'];

// ============================================================
// AdminComponent — the /admin panel (global admins only).
// Content is gated in-component (not by a route guard) so the very
// first "bootstrap" admin — who is not yet an admin — can reach this
// page and self-promote via the setGlobalRole Cloud Function.
// ============================================================
@Component({
  selector:   'tp-admin',
  standalone: true,
  imports:    [RouterLink, FormsModule, IconComponent],
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

  // ---- Platform data (loaded when an admin opens the panel) ----
  readonly users  = signal<AdminUser[]>([]);
  readonly tasks  = signal<TaskLite[]>([]);
  readonly spaces = signal<SpaceLite[]>([]);
  readonly loadingData = signal(false);

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

  /** Per-client data footprint (orgs / spaces / tasks). */
  readonly footprint = computed(() => {
    const orgs = this.orgs.organizations();
    const spaces = this.spaces();
    const tasks = this.tasks();
    return this.clients.clients().map(c => ({
      client: c,
      orgs:   orgs.filter(o => o.clientId === c.id).length,
      spaces: spaces.filter(s => s.clientId === c.id).length,
      tasks:  tasks.filter(t => t.clientId === c.id).length,
    }));
  });

  constructor() {
    // Load platform data once the user is (or becomes) an admin.
    effect(() => { if (this.auth.isAdmin()) this.loadData(); });
  }

  private async loadData(): Promise<void> {
    if (this.loadingData()) return;
    this.loadingData.set(true);
    try {
      const [users, tasks, spaces] = await Promise.all([
        this.admin.allUsers(), this.admin.allTasks(), this.admin.allSpaces(),
      ]);
      this.users.set(users); this.tasks.set(tasks); this.spaces.set(spaces);
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not load platform data');
    } finally {
      this.loadingData.set(false);
    }
  }

  async setUserAdmin(u: AdminUser, makeAdmin: boolean): Promise<void> {
    if (!makeAdmin && !(await this.dialog.confirm({ title: 'Remove admin', message: `Remove admin access from ${u.email}?`, confirmText: 'Remove', danger: true }))) return;
    this.working.set(true);
    try {
      await this.admin.setGlobalRole(u.email, makeAdmin ? 'admin' : null);
      this.users.update(list => list.map(x => x.id === u.id ? { ...x, globalRole: makeAdmin ? 'admin' : null } : x));
      if (u.id === this.auth.userId()) await this.auth.reloadProfile();
      this.toast.success(makeAdmin ? `${u.email} is now an admin` : `${u.email} is no longer an admin`);
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not update the role');
    } finally {
      this.working.set(false);
    }
  }
  userInitial = (u: AdminUser): string => (u.displayName?.charAt(0) || u.email?.charAt(0) || '?').toUpperCase();

  // Create-client form
  readonly showClientForm  = signal(false);
  readonly newClientName   = signal('');
  readonly newClientDesc   = signal('');
  readonly newClientIcon   = signal(CLIENT_ICONS[0]);
  readonly newClientColor  = signal(CLIENT_COLORS[0]);
  readonly creatingClient  = signal(false);

  // Bootstrap (non-admin self-promote)
  readonly claiming = signal(false);

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

  // Promote/demote another admin
  readonly promoteEmail = signal('');
  readonly demoteEmail  = signal('');
  readonly working      = signal(false);

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

  async promote(): Promise<void> {
    const email = this.promoteEmail().trim();
    if (!email) return;
    this.working.set(true);
    try {
      await this.admin.setGlobalRole(email, 'admin');
      this.promoteEmail.set('');
      this.toast.success(`${email} is now an admin`);
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not promote that user');
    } finally {
      this.working.set(false);
    }
  }

  async demote(): Promise<void> {
    const email = this.demoteEmail().trim();
    if (!email) return;
    if (!(await this.dialog.confirm({ title: 'Remove admin access', message: `Remove admin access from ${email}?`, confirmText: 'Remove', danger: true }))) return;
    this.working.set(true);
    try {
      await this.admin.setGlobalRole(email, null);
      this.demoteEmail.set('');
      this.toast.success(`${email} is no longer an admin`);
    } catch (e: any) {
      this.toast.error(this.msg(e) || 'Could not demote that user');
    } finally {
      this.working.set(false);
    }
  }

  private msg(e: any): string {
    return e?.error?.error ?? e?.message ?? '';
  }
}
