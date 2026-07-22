import { Component, input, output, inject, computed } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { TaskService } from '@core/services/task.service';
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
  imports:    [RouterLink, RouterLinkActive, IconComponent, TooltipDirective],
  templateUrl: './sidebar.component.html',
  styleUrl:    './sidebar.component.scss'
})
export class SidebarComponent {
  collapsed      = input(false);
  toggleCollapse = output<void>();

  readonly auth       = inject(AuthService);
  readonly tasks      = inject(TaskService);
  readonly theme      = inject(ThemeService);
  readonly categories = inject(CategoryService);
  readonly release    = inject(ReleaseNotesService);

  readonly navItems: NavItem[] = [
    { label: 'Dashboard',    route: '/dashboard',  icon: 'grid' },
    { label: 'Tasks',        route: '/tasks',      icon: 'check-square', badge: () => this.tasks.overdueTasks().length },
    { label: 'Notes',        route: '/notes',      icon: 'file-text' },
    { label: 'Groups',       route: '/groups',     icon: 'users' },
    { label: 'Organizations',route: '/organizations', icon: 'briefcase' },
    { label: 'Daily Report', route: '/daily',      icon: 'check-circle' },
    { label: 'Calendar',     route: '/calendar',   icon: 'calendar' },
    { label: 'Categories',   route: '/categories', icon: 'folder' },
    { label: 'AI Assistant', route: '/ai-chat',    icon: 'cpu', comingSoon: true },
    { label: 'Analytics',    route: '/analytics',  icon: 'bar-chart-2' },
    { label: "What's New",   route: '/whats-new',  icon: 'sparkles', dot: () => this.release.hasUnseen() }
  ];

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
