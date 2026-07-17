import { Component, output, inject, viewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { TaskService } from '@core/services/task.service';
import { SearchService } from '@core/services/search.service';
import { KeyboardShortcutService } from '@core/services/keyboard-shortcut.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';
import { SearchResult } from '@shared/models/search.model';

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
    this.disposeShortcuts = this.kb.register(
      { keys: '/', description: 'Focus search', group: 'Global', handler: () => this.focusSearch() },
    );
  }

  ngOnDestroy(): void {
    this.disposeShortcuts?.();
  }

  private focusSearch(): void {
    const el = this.searchInput()?.nativeElement;
    el?.focus();
    el?.select();
  }

  /** Navigate to a result and close the dropdown. */
  select(result: SearchResult | null): void {
    if (!result) return;
    this.search.close();
    this.router.navigate(result.route, result.queryParams ? { queryParams: result.queryParams } : {});
  }

  // ---- Keyboard navigation within the search dropdown ----
  onSearchKey(e: KeyboardEvent): void {
    if (!this.search.open()) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); this.search.moveActive(1); this.scrollActiveIntoView(); break;
      case 'ArrowUp':   e.preventDefault(); this.search.moveActive(-1); this.scrollActiveIntoView(); break;
      case 'Enter':     e.preventDefault(); this.select(this.search.activeResult()); break;
    }
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => document.querySelector('.search-item.active')?.scrollIntoView({ block: 'nearest' }), 0);
  }
}
