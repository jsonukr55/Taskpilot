import { Component, input, output, inject, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { TaskService } from '@core/services/task.service';
import { OrganizationService } from '@core/services/organization.service';
import { SpaceService } from '@core/services/space.service';
import { ThemeService, Theme } from '@core/services/theme.service';
import { CategoryService } from '@core/services/category.service';
import { ReleaseNotesService } from '@core/services/release-notes.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';

interface NavItem {
  label:   string;
  route:   string;
  icon:    string;
  badge?:  () => number;
  dot?:    () => boolean;   // small "New" indicator
  comingSoon?: boolean;
}

@Component({
  selector:   'tp-sidebar',
  standalone: true,
  imports:    [NgTemplateOutlet, RouterLink, RouterLinkActive, IconComponent, TooltipDirective],
  templateUrl: './sidebar.component.html',
  styleUrl:    './sidebar.component.scss'
})
export class SidebarComponent {
  collapsed      = input(false);
  toggleCollapse = output<void>();

  readonly auth       = inject(AuthService);
  readonly tasks      = inject(TaskService);
  readonly orgs       = inject(OrganizationService);
  readonly spaces     = inject(SpaceService);
  readonly theme      = inject(ThemeService);
  readonly categories = inject(CategoryService);
  readonly release    = inject(ReleaseNotesService);

  // Personal view — the individual's own productivity space.
  readonly personalNav: NavItem[] = [
    { label: 'Dashboard',    route: '/dashboard',  icon: 'grid' },
    { label: 'Tasks',        route: '/tasks',      icon: 'check-square', badge: () => this.tasks.overdueTasks().length },
    { label: 'Notes',        route: '/notes',      icon: 'file-text' },
    { label: 'Calendar',     route: '/calendar',   icon: 'calendar' },
    { label: 'Categories',   route: '/categories', icon: 'folder' },
    { label: 'Analytics',    route: '/analytics',  icon: 'bar-chart-2' },
    { label: 'AI Assistant', route: '/ai-chat',    icon: 'cpu', comingSoon: true },
    { label: "What's New",   route: '/whats-new',  icon: 'sparkles', dot: () => this.release.hasUnseen() },
  ];

  // Organization view — shared / collaborative workspaces.
  readonly orgNav: NavItem[] = [
    { label: 'Organizations',route: '/organizations', icon: 'briefcase' },
    { label: 'Groups',       route: '/groups',     icon: 'users' },
    { label: 'Daily Report', route: '/daily',      icon: 'check-circle' },
  ];

  // ---- Accordion sections (Personal / Organization) ----
  private readonly STORE_KEY = 'sidebar-sections';
  readonly expanded = signal<Record<string, boolean>>(this.loadExpanded());

  private loadExpanded(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(this.STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { personal: true, org: true };
  }

  isExpanded = (key: string): boolean => this.expanded()[key] !== false;

  toggleSection(key: string): void {
    this.expanded.update(s => {
      const next = { ...s, [key]: !this.isExpanded(key) };
      try { localStorage.setItem(this.STORE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  readonly topCategories = computed(() =>
    this.categories.rootCategories().slice(0, 5)
  );

  // ---- Appearance popover (state shared via ThemeService) --------
  readonly appearanceOpen = this.theme.appearanceOpen;

  readonly themeModes: { value: Theme; label: string; icon: string }[] = [
    { value: 'light',  label: 'Light',  icon: 'sun' },
    { value: 'dark',   label: 'Dark',   icon: 'moon' },
    { value: 'system', label: 'System', icon: 'settings' },
  ];

  toggleAppearance(): void {
    this.appearanceOpen.update(v => !v);
  }

  closeAppearance(): void {
    this.appearanceOpen.set(false);
  }

  selectMode(mode: Theme): void {
    this.theme.setTheme(mode);
    this.auth.updatePreferences({ theme: mode });
  }

  selectAccent(hex: string): void {
    this.theme.setAccent(hex);
  }

  onCustomAccent(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.theme.setAccent(value);
  }
}
