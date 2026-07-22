import { Component, inject, input, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OrganizationService } from '@core/services/organization.service';

type JoinStatus = 'loading' | 'ready' | 'joining' | 'invalid' | 'error';

@Component({
  selector:   'tp-join-org',
  standalone: true,
  imports:    [RouterLink],
  template: `
    <div class="join">
      <div class="join__card card">
        @switch (status()) {
          @case ('loading') {
            <div class="join__state">
              <div class="skeleton" style="width:64px;height:64px;border-radius:16px;"></div>
              <div class="skeleton skeleton-text" style="width:180px;height:20px;"></div>
            </div>
          }
          @case ('invalid') {
            <div class="join__icon join__icon--bad">⛔</div>
            <h1>Invite not available</h1>
            <p>This invite link is invalid, has expired, or was revoked.</p>
            <a routerLink="/organizations" class="btn-secondary">Go to my organizations</a>
          }
          @default {
            <div class="join__icon">{{ preview()?.orgIcon }}</div>
            <p class="join__eyebrow">You've been invited to join</p>
            <h1>{{ preview()?.orgName }}</h1>
            <p class="join__role">You'll join as a <strong>member</strong>.</p>

            @if (status() === 'error') { <p class="join__error">{{ errorMsg() }}</p> }

            <div class="join__actions">
              <a routerLink="/organizations" class="btn-ghost">Not now</a>
              <button class="btn-primary" (click)="join()" [disabled]="status() === 'joining'">
                {{ status() === 'joining' ? 'Joining…' : 'Join organization' }}
              </button>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .join { min-height: 70vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .join__card { width: min(440px, 100%); padding: 40px 32px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .join__icon { width: 72px; height: 72px; display: flex; align-items: center; justify-content: center; font-size: 2rem; border-radius: 20px; background: var(--surface-brand); }
    .join__icon--bad { background: var(--surface-danger); }
    .join__eyebrow { color: var(--text-tertiary); font-size: 0.875rem; }
    h1 { font-size: 1.5rem; font-weight: 700; }
    .join__role { color: var(--text-secondary); font-size: 0.9375rem; }
    .join__error { color: var(--text-danger, #f43f5e); font-size: 0.875rem; }
    .join__state { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .join__actions { display: flex; gap: 8px; margin-top: 8px; }
  `]
})
export class JoinOrgComponent implements OnInit {
  token = input.required<string>();

  private readonly orgs   = inject(OrganizationService);
  private readonly router = inject(Router);

  readonly status   = signal<JoinStatus>('loading');
  readonly preview  = signal<{ orgName: string; orgIcon: string } | null>(null);
  readonly errorMsg = signal('');

  async ngOnInit(): Promise<void> {
    const p = await this.orgs.previewInvite(this.token());
    if (!p) { this.status.set('invalid'); return; }
    this.preview.set(p);
    this.status.set('ready');
  }

  async join(): Promise<void> {
    this.status.set('joining');
    try {
      const res = await this.orgs.joinByToken(this.token());
      await this.router.navigate(['/organizations', res.orgId]);
    } catch (e: unknown) {
      const httpErr = e as { error?: { error?: string }; message?: string };
      this.errorMsg.set(httpErr?.error?.error ?? httpErr?.message ?? 'Could not join the organization.');
      this.status.set('error');
    }
  }
}
