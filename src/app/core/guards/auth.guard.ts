import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  // Wait for our full auth init (onAuthStateChanged callback + profile load)
  await auth.initialized;

  if (auth.isAuthenticated()) return true;
  // Preserve where the user was headed (e.g. an invite link) through login.
  return router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } });
};

export const publicGuard: CanActivateFn = async () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  await auth.initialized;

  if (!auth.isAuthenticated()) return true;
  return router.createUrlTree(['/dashboard']);
};
