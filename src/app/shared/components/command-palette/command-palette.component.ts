import { Component, inject, effect, viewChild, ElementRef, untracked } from '@angular/core';
import { CommandPaletteService } from '@core/services/command-palette.service';
import { PaletteRow } from '@shared/models/command.model';
import { IconComponent } from '../icon/icon.component';

// ============================================================
// CommandPaletteComponent — the ⌘K overlay. Purely a view over
// CommandPaletteService: input drives the query, arrow/enter/escape
// navigate & execute. Rendered once in the shell.
// ============================================================

@Component({
  selector: 'tp-command-palette',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="cmdp__backdrop" (click)="palette.close()"></div>
    <div class="cmdp" role="dialog" aria-label="Command palette">
      <div class="cmdp__search">
        <tp-icon name="search" [size]="16" class="cmdp__search-icon" />
        <input
          #input
          class="cmdp__input"
          type="text"
          placeholder="Type a command or search…"
          [value]="palette.query()"
          (input)="palette.setQuery($any($event.target).value)"
          (keydown)="onKey($event)"
        />
        <kbd class="cmdp__hint">Esc</kbd>
      </div>

      <div class="cmdp__list">
        @for (group of palette.groups(); track group.label) {
          <div class="cmdp__group">
            <p class="cmdp__group-label">{{ group.label }}</p>
            @for (row of group.rows; track row.id) {
              <button class="cmdp__row" [class.active]="palette.isActiveRow(row)"
                      (click)="palette.runRow(row)" (mouseenter)="hover(row)">
                <span class="cmdp__row-icon">
                  @if (row.emoji) { {{ row.emoji }} } @else { <tp-icon [name]="row.icon" [size]="15" /> }
                </span>
                <span class="cmdp__row-title">{{ row.title }}</span>
                @if (row.subtitle) { <span class="cmdp__row-sub">{{ row.subtitle }}</span> }
              </button>
            }
          </div>
        }
        @if (!palette.hasRows()) {
          <div class="cmdp__empty">No matching commands or results.</div>
        }
      </div>
    </div>
  `,
  styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent {
  readonly palette = inject(CommandPaletteService);
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');

  constructor() {
    // Focus the input whenever the palette opens.
    effect(() => {
      if (this.palette.open()) {
        untracked(() => setTimeout(() => this.input()?.nativeElement.focus()));
      }
    });
  }

  onKey(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); this.palette.moveActive(1); this.scrollActive(); break;
      case 'ArrowUp':   e.preventDefault(); this.palette.moveActive(-1); this.scrollActive(); break;
      case 'Enter':     e.preventDefault(); this.palette.runActive(); break;
      case 'Escape':    e.preventDefault(); this.palette.close(); break;
    }
  }

  /** Sync the active row to the hovered one (mouse + keyboard agree). */
  hover(row: PaletteRow): void {
    const idx = this.palette.rows().findIndex(r => r.id === row.id);
    if (idx >= 0) this.palette.activeIndex.set(idx);
  }

  private scrollActive(): void {
    setTimeout(() => document.querySelector('.cmdp__row.active')?.scrollIntoView({ block: 'nearest' }), 0);
  }
}
