import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withViewTransitions, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideIcons } from '@ng-icons/core';
import { routes } from './app.routes';
import { APP_ICONS } from './shared/icons';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes,
      withViewTransitions(),
      withComponentInputBinding()
    ),
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimationsAsync(),
    provideIcons(APP_ICONS)
  ]
};
