import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';
import { ToastComponent } from '@shared/components/toast/toast.component';
import { KeyboardHelpComponent } from '@shared/components/keyboard-help/keyboard-help.component';
import { CommandPaletteComponent } from '@shared/components/command-palette/command-palette.component';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { SchedulingService } from '@core/services/scheduling.service';
import { GroupService } from '@core/services/group.service';
import { OrganizationService } from '@core/services/organization.service';
import { SpaceService } from '@core/services/space.service';
import { ClientService } from '@core/services/client.service';
import { KeyboardShortcutService } from '@core/services/keyboard-shortcut.service';
import { CommandPaletteService } from '@core/services/command-palette.service';

@Component({
  selector:   'tp-shell',
  standalone: true,
  imports:    [RouterOutlet, SidebarComponent, TopbarComponent, ToastComponent, KeyboardHelpComponent, CommandPaletteComponent],
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
    @if (kb.helpOpen()) { <tp-keyboard-help /> }
    @if (palette.open()) { <tp-command-palette /> }
  `,
  styleUrl: './shell.component.scss'
})
export class ShellComponent implements OnInit, OnDestroy {
  private readonly tasks      = inject(TaskService);
  private readonly categories = inject(CategoryService);
  private readonly scheduling = inject(SchedulingService);
  private readonly groups     = inject(GroupService);
  private readonly orgs       = inject(OrganizationService);
  private readonly spaces     = inject(SpaceService);
  private readonly clients    = inject(ClientService);
  private readonly router     = inject(Router);
  readonly kb                 = inject(KeyboardShortcutService);
  readonly palette            = inject(CommandPaletteService);

  readonly sidebarCollapsed = signal(window.innerWidth < 768);

  private disposeShortcuts?: () => void;

  ngOnInit(): void {
    this.tasks.startListening();
    this.categories.startListening();
    this.scheduling.startListening();
    this.groups.startListening();
    this.orgs.startListening();
    this.spaces.startListening();
    this.clients.startListening();

    // App-wide shortcuts.
    this.disposeShortcuts = this.kb.registerAll([
      {
        keys: 'n', description: 'New task', group: 'Global',
        handler: () => { this.router.navigate(['/tasks'], { queryParams: { new: true } }); },
      },
      {
        keys: ['?', 'shift+/'], description: 'Show keyboard shortcuts', group: 'Global',
        handler: () => this.kb.toggleHelp(),
      },
      {
        keys: 'escape', when: () => this.kb.helpOpen(), allowInInput: true,
        handler: () => this.kb.helpOpen.set(false),
      },
    ]);
  }

  ngOnDestroy(): void {
    this.tasks.stopListening();
    this.categories.stopListening();
    this.scheduling.stopListening();
    this.groups.stopListening();
    this.orgs.stopListening();
    this.spaces.stopListening();
    this.clients.stopListening();
    this.disposeShortcuts?.();
  }
}
