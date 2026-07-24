import { Component, inject, input, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { OrganizationService } from '@core/services/organization.service';
import { SpaceService } from '@core/services/space.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { MenuComponent, MenuItem } from '@shared/components/menu/menu.component';
import { orgMembers, OrgInvite, OrgRole, ASSIGNABLE_ORG_ROLES, ORG_ROLE_LABELS } from '@shared/models/organization.model';
import { Space } from '@shared/models/space.model';

const SPACE_ICONS  = ['📁','🚀','🎯','🧩','📊','🛠️','🎨','🔬','📌','🗂️','💡','📈'];
const SPACE_COLORS = ['#6366f1','#10b981','#f59e0b','#f43f5e','#8b5cf6','#0ea5e9','#ec4899','#14b8a6'];

@Component({
  selector:   'tp-org-detail',
  standalone: true,
  imports:    [RouterLink, FormsModule, IconComponent, MenuComponent],
  templateUrl: './org-detail.component.html',
  styleUrl:    './org-detail.component.scss'
})
export class OrgDetailComponent {
  orgId = input.required<string>();

  readonly orgs   = inject(OrganizationService);
  readonly spaces = inject(SpaceService);
  readonly auth   = inject(AuthService);
  private readonly toast  = inject(ToastService);
  private readonly router = inject(Router);

  readonly SPACE_ICONS = SPACE_ICONS;
  readonly SPACE_COLORS = SPACE_COLORS;

  readonly org      = computed(() => this.orgs.getOrgById(this.orgId()));
  readonly notFound = computed(() => !this.orgs.isLoading() && !this.org());
  readonly members  = computed(() => { const o = this.org(); return o ? orgMembers(o) : []; });
  readonly canManage = computed(() => this.orgs.canManageOrg(this.org()));
  readonly isOwner   = computed(() => this.orgs.isOrgOwner(this.org()));
  readonly orgSpaces = computed(() => this.spaces.spacesInOrg(this.orgId())
    .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)));

  // ---- Add member ----
  readonly addEmail = signal('');
  readonly addingMember = signal(false);

  async addMember(): Promise<void> {
    const email = this.addEmail().trim();
    if (!email) return;
    this.addingMember.set(true);
    try {
      const res = await this.orgs.addMemberByEmail(this.orgId(), email);
      this.addEmail.set('');
      this.toast.success(`${res.displayName} added`);
    } catch (e: any) {
      this.toast.error(e?.error?.error ?? e?.message ?? 'Could not add that user');
    } finally {
      this.addingMember.set(false);
    }
  }

  async removeMember(uid: string): Promise<void> {
    if (!confirm('Remove this member from the organization?')) return;
    try { await this.orgs.removeMember(this.orgId(), uid); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not remove the member'); }
  }

  // ---- Role management ----
  readonly ASSIGNABLE_ORG_ROLES = ASSIGNABLE_ORG_ROLES;
  roleLabel = (r: OrgRole): string => ORG_ROLE_LABELS[r] ?? r;

  async changeRole(uid: string, role: string): Promise<void> {
    try {
      await this.orgs.changeRole(this.orgId(), uid, role as OrgRole);
      this.toast.success('Role updated');
    } catch (e: any) {
      this.toast.error(e?.error?.error ?? e?.message ?? 'Could not update the role');
    }
  }

  memberName = (uid: string): string => this.org()?.memberProfiles[uid]?.displayName ?? 'Member';
  initial = (name: string): string => (name?.charAt(0) || '?').toUpperCase();

  // ---- Invites ----
  readonly showInvite    = signal(false);
  readonly inviteLink    = signal<string | null>(null);
  readonly activeInvites = signal<OrgInvite[]>([]);
  readonly copied        = signal(false);
  readonly inviteBase    = `${window.location.origin}/org-join/`;

  async openInvite(): Promise<void> {
    this.inviteLink.set(null);
    this.copied.set(false);
    this.showInvite.set(true);
    await this.refreshInvites();
  }
  async generateLink(): Promise<void> {
    const o = this.org();
    if (!o) return;
    try {
      const { url } = await this.orgs.createInvite(o);
      this.inviteLink.set(url);
      await this.refreshInvites();
    } catch (e: any) { this.toast.error(e?.message ?? 'Could not create the invite'); }
  }
  async refreshInvites(): Promise<void> {
    try { this.activeInvites.set(await this.orgs.listInvites(this.orgId())); } catch { /* non-owner */ }
  }
  async copyLink(url: string): Promise<void> {
    try { await navigator.clipboard.writeText(url); this.copied.set(true); setTimeout(() => this.copied.set(false), 1800); }
    catch { this.toast.error('Could not access the clipboard'); }
  }
  async revoke(token: string): Promise<void> {
    await this.orgs.revokeInvite(token);
    await this.refreshInvites();
  }

  // ---- Create space ----
  readonly showSpace = signal(false);
  readonly spaceName  = signal('');
  readonly spaceIcon  = signal('📁');
  readonly spaceColor = signal('#6366f1');
  readonly creatingSpace = signal(false);

  openCreateSpace(): void {
    this.spaceName.set(''); this.spaceIcon.set('📁'); this.spaceColor.set('#6366f1');
    this.showSpace.set(true);
  }
  async createSpace(): Promise<void> {
    const name = this.spaceName().trim();
    if (name.length < 2) return;
    this.creatingSpace.set(true);
    try {
      const id = await this.spaces.createSpace(this.orgId(), {
        name, description: '', icon: this.spaceIcon(), color: this.spaceColor(),
      });
      this.showSpace.set(false);
      await this.router.navigate(['/organizations', this.orgId(), 'spaces', id]);
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not create the space');
    } finally {
      this.creatingSpace.set(false);
    }
  }

  openSpace(id: string): void { void this.router.navigate(['/organizations', this.orgId(), 'spaces', id]); }

  spaceMenu(s: Space): MenuItem[] {
    const items: MenuItem[] = [{ label: 'Open', icon: 'arrow-right', action: () => this.openSpace(s.id) }];
    if (this.canManage() || this.spaces.isSpaceOwner(s)) {
      items.push({ label: 'Delete', icon: 'trash-2', danger: true, action: () => this.deleteSpace(s) });
    }
    return items;
  }

  async deleteSpace(s: Space): Promise<void> {
    if (!confirm(`Delete space "${s.name}"? This removes its tasks.`)) return;
    try { await this.spaces.deleteSpace(s.id); this.toast.success('Space deleted'); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not delete the space'); }
  }

  // ---- Settings ----
  readonly showSettings = signal(false);
  readonly editName  = signal('');
  readonly editDesc  = signal('');
  readonly editIcon  = signal('🏢');
  readonly editColor = signal('#6366f1');
  readonly ICONS  = ['🏢','🚀','🌐','💼','🏗️','🧩','📊','🛠️','🔬','🎯','🏦','⚙️'];
  readonly COLORS = SPACE_COLORS;

  openSettings(): void {
    const o = this.org();
    if (!o) return;
    this.editName.set(o.name); this.editDesc.set(o.description ?? '');
    this.editIcon.set(o.icon); this.editColor.set(o.color);
    this.showSettings.set(true);
  }
  async saveSettings(): Promise<void> {
    const name = this.editName().trim();
    if (name.length < 2) return;
    try {
      await this.orgs.updateOrganization(this.orgId(), {
        name, description: this.editDesc().trim(), icon: this.editIcon(), color: this.editColor(),
      });
      this.showSettings.set(false);
      this.toast.success('Organization updated');
    } catch (e: any) { this.toast.error(e?.message ?? 'Could not update the organization'); }
  }
  async deleteOrg(): Promise<void> {
    const o = this.org();
    if (!o || !confirm(`Delete "${o.name}"? This removes the organization, its spaces and their tasks for everyone.`)) return;
    try {
      await this.orgs.deleteOrganization(o.id);
      await this.router.navigate(['/organizations']);
    } catch (e: any) { this.toast.error(e?.message ?? 'Could not delete the organization'); }
  }
}
