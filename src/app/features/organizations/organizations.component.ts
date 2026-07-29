import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { OrganizationService } from '@core/services/organization.service';
import { ClientService } from '@core/services/client.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { DialogService } from '@core/services/dialog.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { MenuComponent, MenuItem } from '@shared/components/menu/menu.component';
import { AvatarPickerComponent } from '@shared/components/avatar-picker/avatar-picker.component';
import { EntityAvatarComponent } from '@shared/components/entity-avatar/entity-avatar.component';
import { LogoService } from '@core/services/logo.service';
import { Organization } from '@shared/models/organization.model';

const ORG_COLORS = ['#6366f1','#10b981','#f59e0b','#f43f5e','#8b5cf6','#0ea5e9','#ec4899','#14b8a6'];

@Component({
  selector:   'tp-organizations',
  standalone: true,
  imports:    [RouterLink, ReactiveFormsModule, IconComponent, MenuComponent,
               AvatarPickerComponent, EntityAvatarComponent],
  templateUrl: './organizations.component.html',
  styleUrl:    './organizations.component.scss'
})
export class OrganizationsComponent implements OnInit {
  readonly orgs    = inject(OrganizationService);
  readonly clients = inject(ClientService);
  readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  open(id: string): void { void this.router.navigate(['/organizations', id]); }

  menuFor(o: Organization): MenuItem[] {
    const items: MenuItem[] = [
      { label: 'Open', icon: 'arrow-right', action: () => this.open(o.id) },
    ];
    if (this.orgs.canManageOrg(o)) {
      items.push({ label: 'Delete', icon: 'trash-2', danger: true, action: () => this.deleteOrg(o) });
    }
    return items;
  }

  async deleteOrg(o: Organization): Promise<void> {
    if (!(await this.dialog.confirm({ title: 'Delete organization', message: `Delete "${o.name}"? This removes its spaces and their tasks for everyone.`, confirmText: 'Delete', danger: true }))) return;
    try { await this.orgs.deleteOrganization(o.id); this.toast.success('Organization deleted'); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not delete the organization'); }
  }

  readonly showForm     = signal(false);
  readonly isSubmitting = signal(false);
  readonly COLORS = ORG_COLORS;

  private readonly logos = inject(LogoService);
  /** Chosen logo, held until the org exists — see IconPickerComponent. */
  readonly pendingLogo = signal<File | null>(null);

  readonly form = this.fb.group({
    name:        ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    icon:        ['🏢'],
    color:       ['#6366f1'],
    clientId:    ['' as string]
  });

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('new') && this.auth.isAdmin()) {
      this.startCreate(this.route.snapshot.queryParamMap.get('client'));
    }
  }

  memberCount = (o: Organization): number => o.memberIds.length;

  startCreate(clientId: string | null = null): void {
    this.form.reset({ name: '', description: '', icon: '🏢', color: '#6366f1', clientId: clientId ?? '' });
    this.pendingLogo.set(null);
    this.showForm.set(true);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.isSubmitting.set(true);
    const v = this.form.value;
    try {
      const id = await this.orgs.createOrganization({
        name:        v.name!,
        description: v.description ?? '',
        icon:        v.icon!,
        color:       v.color!,
        clientId:    v.clientId || null
      });

      // Storage RLS checks the org exists and that we can manage it, so an
      // uploaded logo can only be stored once the row is in place.
      const file = this.pendingLogo();
      if (file) {
        try {
          const iconUrl = await this.logos.upload('organizations', id, file);
          await this.orgs.updateOrganization(id, { iconUrl });
        } catch {
          this.toast.error('Organization created, but the logo failed to upload. Add it from settings.');
        }
      }

      this.showForm.set(false);
      this.toast.success('Organization created');
    } catch (e: any) {
      this.toast.error(e?.message ?? 'Could not create the organization');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
