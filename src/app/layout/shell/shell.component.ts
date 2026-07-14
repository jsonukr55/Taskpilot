import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';
import { ToastComponent } from '@shared/components/toast/toast.component';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { SchedulingService } from '@core/services/scheduling.service';
import { GroupService } from '@core/services/group.service';

@Component({
  selector:   'tp-shell',
  standalone: true,
  imports:    [RouterOutlet, SidebarComponent, TopbarComponent, ToastComponent],
  template: `
    <div class="shell" [class.sidebar-collapsed]="sidebarCollapsed()">
      @if (!sidebarCollapsed()) {
        <div class="shell__mobile-backdrop" (click)="sidebarCollapsed.set(true)"></div>
      }
      <tp-sidebar
        [collapsed]="sidebarCollapsed()"
        (toggleCollapse)="sidebarCollapsed.set(!sidebarCollapsed())"
      />
      <div class="shell__main">
        <tp-topbar (toggleSidebar)="sidebarCollapsed.set(!sidebarCollapsed())" />
        <main class="shell__content">
          <router-outlet />
        </main>
      </div>
    </div>
    <tp-toast />
  `,
  styleUrl: './shell.component.scss'
})
export class ShellComponent implements OnInit, OnDestroy {
  private readonly tasks      = inject(TaskService);
  private readonly categories = inject(CategoryService);
  private readonly scheduling = inject(SchedulingService);
  private readonly groups     = inject(GroupService);

  readonly sidebarCollapsed = signal(window.innerWidth < 768);

  ngOnInit(): void {
    this.tasks.startListening();
    this.categories.startListening();
    this.scheduling.startListening();
    this.groups.startListening();
  }

  ngOnDestroy(): void {
    this.tasks.stopListening();
    this.categories.stopListening();
    this.scheduling.stopListening();
    this.groups.stopListening();
  }
}
