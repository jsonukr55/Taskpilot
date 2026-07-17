import { Component, output, inject, viewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { TaskService } from '@core/services/task.service';
import { SearchService, NoteHit } from '@core/services/search.service';
import { KeyboardShortcutService } from '@core/services/keyboard-shortcut.service';
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
export class TopbarComponent implements OnInit, OnDestroy {
  toggleSidebar = output<void>();

  readonly auth   = inject(AuthService);
  readonly tasks  = inject(TaskService);
  readonly search = inject(SearchService);
  private readonly router = inject(Router);
  private readonly kb     = inject(KeyboardShortcutService);

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private disposeShortcuts?: () => void;

  ngOnInit(): void {
    this.disposeShortcuts = this.kb.registerAll([
      { keys: 'mod+k', description: 'Focus search', group: 'Global', allowInInput: true, handler: () => this.focusSearch() },
      { keys: '/',     description: 'Focus search', group: 'Global', handler: () => this.focusSearch() },
    ]);
  }

  ngOnDestroy(): void {
    this.disposeShortcuts?.();
  }

  private focusSearch(): void {
    const el = this.searchInput()?.nativeElement;
    el?.focus();
    el?.select();
  }

  openTask(t: Task): void {
    this.search.close();
    this.router.navigate(['/tasks', t.id]);
  }

  openNote(hit: NoteHit): void {
    this.search.close();
    this.router.navigate(hit.link);
  }
}
