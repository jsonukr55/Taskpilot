import {
  AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild,
  computed, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { BrandMarkComponent } from '@shared/components/brand-mark/brand-mark.component';
import { startBrandMotion } from './brand-motion';

type AuthTab = 'login' | 'register';

interface AuthPoint {
  icon:  string;
  title: string;
  desc:  string;
}

@Component({
  selector:    'tp-login',
  standalone:  true,
  imports:     [FormsModule, IconComponent, BrandMarkComponent],
  templateUrl: './login.component.html',
  styleUrl:    './login.component.scss'
})
export class LoginComponent implements AfterViewInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  @ViewChild('brandPanel')     private brandPanel?: ElementRef<HTMLElement>;
  @ViewChild('particlesCanvas') private particlesCanvas?: ElementRef<HTMLCanvasElement>;

  private stopBrandMotion?: () => void;

  readonly tab          = signal<AuthTab>('login');
  readonly isLoading    = signal(false);
  readonly error        = signal<string | null>(null);
  readonly showPassword = signal(false);

  readonly isRegister = computed(() => this.tab() === 'register');

  readonly heading = computed(() =>
    this.isRegister() ? 'Create your account' : 'Welcome back');

  readonly subheading = computed(() => this.isRegister()
    ? 'Set up your workspace in under a minute.'
    : 'Sign in to pick up where you left off.');

  /** Shown in the brand panel (desktop) and condensed under the form (mobile). */
  readonly points: AuthPoint[] = [
    { icon: 'sparkles',    title: 'AI task extraction',   desc: 'Turn notes, chats and screenshots into structured tasks.' },
    { icon: 'calendar',    title: 'Smart scheduling',     desc: 'Plan due dates automatically and keep your calendar in sync.' },
    { icon: 'bar-chart-2', title: 'Analytics & insights', desc: 'See where work is stuck before a deadline slips.' },
  ];

  // Form fields
  name     = '';
  email    = '';
  password = '';

  ngAfterViewInit(): void {
    const panel  = this.brandPanel?.nativeElement;
    const canvas = this.particlesCanvas?.nativeElement;
    if (!panel || !canvas) return;
    // Honour the OS "reduce motion" setting — the panel keeps its static gradient.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.zone.runOutsideAngular(() => {
      this.stopBrandMotion = startBrandMotion(panel, canvas);
    });
  }

  ngOnDestroy(): void {
    this.stopBrandMotion?.();
  }

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

  /** Single submit handler — the active tab decides sign-in vs register. */
  async submit(): Promise<void> {
    await (this.isRegister() ? this.register() : this.signInWithEmail());
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

  togglePassword(): void {
    this.showPassword.update(v => !v);
  }

  private friendlyError(e: unknown): string {
    const code = (e as { code?: string }).code ?? '';
    const msg  = e instanceof Error ? e.message : '';
    const m    = msg.toLowerCase();

    if (code === 'invalid_credentials' || m.includes('invalid login credentials') ||
        code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential')
      return 'Invalid email or password.';
    if (code === 'user_already_exists' || m.includes('already registered') ||
        code === 'auth/email-already-in-use')
      return 'An account with this email already exists.';
    if (m.includes('password should be at least') || code === 'auth/weak-password')
      return 'Password must be at least 6 characters.';
    if (m.includes('unable to validate email') || m.includes('invalid email') ||
        code === 'auth/invalid-email')
      return 'Please enter a valid email address.';
    if (m.includes('email not confirmed'))
      return 'Please confirm your email address, then sign in.';
    return msg || 'Something went wrong. Try again.';
  }
}
