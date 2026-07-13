import { Component, output, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TaskService } from '@core/services/task.service';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';

@Component({
  selector:   'tp-topbar',
  standalone: true,
  imports:    [RouterLink, FormsModule, IconComponent, TooltipDirective],
  templateUrl: './topbar.component.html',
  styleUrl:    './topbar.component.scss'
})
export class TopbarComponent {
  toggleSidebar = output<void>();

  readonly auth  = inject(AuthService);
  readonly tasks = inject(TaskService);

  readonly searchValue = signal('');

  onSearch(value: string): void {
    this.tasks.searchQuery.set(value);
  }
}
