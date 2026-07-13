import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '@shared/components/icon/icon.component';

type AuthTab = 'google' | 'login' | 'register';

@Component({
  selector:    'tp-login',
  standalone:  true,
  imports:     [FormsModule, IconComponent],
  templateUrl: './login.component.html',
  styleUrl:    './login.component.scss'
})
export class LoginComponent {
  private readonly auth = inject(AuthService);

  readonly tab        = signal<AuthTab>('google');
  readonly isLoading  = signal(false);
  readonly error      = signal<string | null>(null);

  // Form fields
  name     = '';
  email    = '';
  password = '';

  async signInWithGoogle(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      await this.auth.signInWithGoogle();
      // Page will redirect to Google — isLoading stays true intentionally
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Sign-in failed.');
      this.isLoading.set(false);
    }
  }

  async signInWithEmail(): Promise<void> {
    if (!this.email || !this.password) return;
    this.isLoading.set(true);
    this.error.set(null);
    try {
      await this.auth.signInWithEmail(this.email, this.password);
    } catch (e: unknown) {
      this.error.set(this.friendlyError(e));
      this.isLoading.set(false);
    }
  }

  async register(): Promise<void> {
    if (!this.name || !this.email || !this.password) return;
    this.isLoading.set(true);
    this.error.set(null);
    try {
      await this.auth.signUpWithEmail(this.name, this.email, this.password);
    } catch (e: unknown) {
      this.error.set(this.friendlyError(e));
      this.isLoading.set(false);
    }
  }

  switchTab(t: AuthTab): void {
    this.tab.set(t);
    this.error.set(null);
  }

  private friendlyError(e: unknown): string {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential')
      return 'Invalid email or password.';
    if (code === 'auth/email-already-in-use')
      return 'An account with this email already exists.';
    if (code === 'auth/weak-password')
      return 'Password must be at least 6 characters.';
    if (code === 'auth/invalid-email')
      return 'Please enter a valid email address.';
    return e instanceof Error ? e.message : 'Something went wrong. Try again.';
  }
}
