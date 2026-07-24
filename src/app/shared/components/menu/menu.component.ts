import { Component, input, signal } from '@angular/core';
import { IconComponent } from '@shared/components/icon/icon.component';

export interface MenuItem {
  label:   string;
  icon?:   string;
  danger?: boolean;
  action:  () => void;
}

// ============================================================
// tp-menu — a reusable "⋯" context menu (Monday-style row actions).
//   <tp-menu [items]="[{ label:'Open', icon:'arrow-right', action: () => ... },
//                       { label:'Delete', icon:'trash-2', danger:true, action: () => ... }]" />
// Stops row-click propagation; closes on outside click / item select.
// ============================================================
@Component({
  selector:   'tp-menu',
  standalone: true,
  imports:    [IconComponent],
  template: `
    <div class="menu" (click)="$event.stopPropagation()">
      <button class="menu__trigger" [class.is-open]="open()" (click)="toggle()" aria-label="More actions">
        <tp-icon [name]="triggerIcon()" [size]="16" />
      </button>
      @if (open()) {
        <div class="menu__backdrop" (click)="close()"></div>
        <div class="menu__list" [class.menu__list--left]="align() === 'left'">
          @for (it of items(); track it.label) {
            <button class="menu__item" [class.menu__item--danger]="it.danger" (click)="run(it)">
              @if (it.icon) { <tp-icon [name]="it.icon" [size]="14" /> }
              <span>{{ it.label }}</span>
            </button>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './menu.component.scss',
})
export class MenuComponent {
  readonly items       = input<MenuItem[]>([]);
  readonly triggerIcon = input('more-horizontal');
  readonly align       = input<'left' | 'right'>('right');

  readonly open = signal(false);
  toggle(): void { this.open.update(v => !v); }
  close(): void { this.open.set(false); }
  run(it: MenuItem): void { this.close(); it.action(); }
}
