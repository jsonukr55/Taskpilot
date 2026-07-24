import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { GroupService } from '@core/services/group.service';
import { ToastService } from '@core/services/toast.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { MenuComponent, MenuItem } from '@shared/components/menu/menu.component';
import { Group, ROLE_LABELS, GroupRole } from '@shared/models/group.model';

const GROUP_ICONS  = ['👥','🚀','📁','🎯','💼','🧩','🏗️','🌐','🔬','🎨','📊','🛠️'];
const GROUP_COLORS = ['#6366f1','#10b981','#f59e0b','#f43f5e','#8b5cf6','#0ea5e9','#ec4899','#14b8a6'];

@Component({
  selector:   'tp-groups',
  standalone: true,
  imports:    [RouterLink, ReactiveFormsModule, IconComponent, MenuComponent],
  templateUrl: './groups.component.html',
  styleUrl:    './groups.component.scss'
})
export class GroupsComponent implements OnInit {
  readonly groups = inject(GroupService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  open(id: string): void { void this.router.navigate(['/groups', id]); }

  groupMenu(g: Group): MenuItem[] {
    const items: MenuItem[] = [{ label: 'Open', icon: 'arrow-right', action: () => this.open(g.id) }];
    if (this.groups.isOwner(g)) {
      items.push({ label: 'Delete', icon: 'trash-2', danger: true, action: () => this.deleteGroup(g) });
    }
    return items;
  }

  async deleteGroup(g: Group): Promise<void> {
    if (!confirm(`Delete group "${g.name}"? This removes its shared notes and tasks.`)) return;
    try { await this.groups.deleteGroup(g.id); this.toast.success('Group deleted'); }
    catch (e: any) { this.toast.error(e?.message ?? 'Could not delete the group'); }
  }

  ngOnInit(): void {
    // Deep-link: /groups?new=true opens the create modal (used by the dashboard quick action).
    if (this.route.snapshot.queryParamMap.get('new')) this.startCreate();
  }

  readonly showForm     = signal(false);
  readonly isSubmitting = signal(false);
  readonly ICONS  = GROUP_ICONS;
  readonly COLORS = GROUP_COLORS;

  readonly form = this.fb.group({
    name:        ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    icon:        ['👥'],
    color:       ['#6366f1']
  });

  memberCount = (g: Group): number => g.memberIds.length;

  roleLabel = (g: Group): string => {
    const r = this.groups.myRole(g);
    return r ? ROLE_LABELS[r as GroupRole] : '';
  };

  startCreate(): void {
    this.form.reset({ name: '', description: '', icon: '👥', color: '#6366f1' });
    this.showForm.set(true);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.isSubmitting.set(true);
    const v = this.form.value;
    try {
      await this.groups.createGroup({
        name:        v.name!,
        description: v.description ?? '',
        icon:        v.icon!,
        color:       v.color!
      });
      this.showForm.set(false);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
