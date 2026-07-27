import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from '@core/services/theme.service';
import { AuthService } from '@core/services/auth.service';
import { AppDialogComponent } from '@shared/components/app-dialog/app-dialog.component';

@Component({
  selector:    'tp-root',
  standalone:  true,
  imports:     [RouterOutlet, AppDialogComponent],
  template:    `<router-outlet /><tp-app-dialog />`,
  styles: [`
    :host { display: block; height: 100vh; }
  `]
})
export class AppComponent implements OnInit {
  private readonly theme = inject(ThemeService);
  private readonly auth  = inject(AuthService);

  ngOnInit(): void {
    // ThemeService constructor already handles initialization
  }
}
