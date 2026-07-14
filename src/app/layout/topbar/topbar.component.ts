import { Component, output, inject } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { TaskService } from '@core/services/task.service';
import { SearchService, NoteHit } from '@core/services/search.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';
import { Task } from '@shared/models/task.model';

@Component({
  selector:   'tp-topbar',
  standalone: true,
  imports:    [RouterLink, IconComponent, TooltipDirective],
  templateUrl: './topbar.component.html',
  styleUrl:    './topbar.component.scss'
})
export class TopbarComponent {
  toggleSidebar = output<void>();

  readonly auth   = inject(AuthService);
  readonly tasks  = inject(TaskService);
  readonly search = inject(SearchService);
  private readonly router = inject(Router);

  openTask(t: Task): void {
    this.search.close();
    this.router.navigate(['/tasks', t.id]);
  }

  openNote(hit: NoteHit): void {
    this.search.close();
    this.router.navigate(hit.link);
  }
}
