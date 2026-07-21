import { Component, input, computed } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

// ============================================================
// tp-icon — thin wrapper over ng-icons (@ng-icons/core).
// The icon set is registered app-wide under kebab names in
// shared/icons.ts (provideIcons in app.config), so this component
// keeps the same `name` / `size` API the whole app already uses —
// every icon is now rendered from the ng-icons Feather/Lucide packs.
// ============================================================
@Component({
  selector:   'tp-icon',
  standalone: true,
  imports:    [NgIcon],
  template: `@if (name()) { <ng-icon [name]="name()" [size]="pxSize()" /> }`,
  styles: [`
    :host { display: inline-flex; align-items: center; justify-content: center; }
    ng-icon { display: block; line-height: 0; }
  `]
})
export class IconComponent {
  name = input.required<string>();
  size = input<number>(20);

  /** ng-icons accepts a CSS size string; keep the numeric px API. */
  readonly pxSize = computed(() => `${this.size()}px`);
}
