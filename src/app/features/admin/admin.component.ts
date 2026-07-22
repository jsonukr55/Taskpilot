import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/services/auth.service';
import { AdminService } from '@core/services/admin.service';
import { OrganizationService } from '@core/services/organization.service';
import { ClientService } from '@core/services/client.service';
import { ToastService } from '@core/services/toast.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { Client } from '@shared/models/client.model';

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

  readonly CLIENT_ICONS  = CLIENT_ICONS;
  readonly CLIENT_COLORS = CLIENT_COLORS;

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
    if (!confirm(warning)) return;
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
    if (!confirm(`Remove admin access from ${email}?`)) return;
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
