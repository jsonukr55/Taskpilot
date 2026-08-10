import { Component, inject } from '@angular/core';
import { ThemeService, Theme } from '@core/services/theme.service';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';

// ============================================================
// tp-appearance — theme + accent picker button with a dropdown panel.
// Extracted from the sidebar so it can live in the top-right header.
// ============================================================
@Component({
  selector:   'tp-appearance',
  standalone: true,
  imports:    [IconComponent, TooltipDirective],
  templateUrl: './appearance-menu.component.html',
  styleUrl:    './appearance-menu.component.scss',
})
export class AppearanceMenuComponent {
  readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);

  readonly appearanceOpen = this.theme.appearanceOpen;
  readonly themeModes: { value: Theme; label: string; icon: string }[] = [
    { value: 'light',  label: 'Light',  icon: 'sun' },
    { value: 'dark',   label: 'Dark',   icon: 'moon' },
    { value: 'system', label: 'System', icon: 'settings' },
  ];

  toggle(): void { this.appearanceOpen.update(v => !v); }
  close(): void { this.appearanceOpen.set(false); }
  selectMode(mode: Theme): void { this.theme.setTheme(mode); this.auth.updatePreferences({ theme: mode }); }
  selectAccent(hex: string): void { this.theme.setAccent(hex); }
  onCustomAccent(event: Event): void { this.theme.setAccent((event.target as HTMLInputElement).value); }
}
