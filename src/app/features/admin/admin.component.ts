import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/services/auth.service';
import { AdminService } from '@core/services/admin.service';
import { OrganizationService } from '@core/services/organization.service';
import { ToastService } from '@core/services/toast.service';
import { IconComponent } from '@shared/components/icon/icon.component';

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
  readonly auth  = inject(AuthService);
  readonly orgs  = inject(OrganizationService);
  private readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);

  // Bootstrap (non-admin self-promote)
  readonly claiming = signal(false);

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
