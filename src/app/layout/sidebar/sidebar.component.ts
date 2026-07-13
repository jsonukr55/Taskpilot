import { Component, input, output, inject, computed } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { TaskService } from '@core/services/task.service';
import { ThemeService } from '@core/services/theme.service';
import { CategoryService } from '@core/services/category.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';

interface NavItem {
  label:   string;
  route:   string;
  icon:    string;
  badge?:  () => number;
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

  readonly navItems: NavItem[] = [
    { label: 'Dashboard',    route: '/dashboard',  icon: 'grid' },
    { label: 'Tasks',        route: '/tasks',      icon: 'check-square', badge: () => this.tasks.overdueTasks().length },
    { label: 'Notes',        route: '/notes',      icon: 'file-text' },
    { label: 'Groups',       route: '/groups',     icon: 'users' },
    { label: 'Calendar',     route: '/calendar',   icon: 'calendar' },
    { label: 'Categories',   route: '/categories', icon: 'folder' },
    { label: 'AI Assistant', route: '/ai-chat',    icon: 'cpu', comingSoon: true },
    { label: 'Analytics',    route: '/analytics',  icon: 'bar-chart-2' }
  ];

  readonly topCategories = computed(() =>
    this.categories.rootCategories().slice(0, 5)
  );
}
