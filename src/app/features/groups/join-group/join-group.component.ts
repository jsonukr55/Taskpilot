import { Component, inject, input, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { GroupService } from '@core/services/group.service';
import { ROLE_LABELS } from '@shared/models/group.model';

type JoinStatus = 'loading' | 'ready' | 'joining' | 'invalid' | 'error';

@Component({
  selector:   'tp-join-group',
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
            <a routerLink="/groups" class="btn-secondary">Go to my groups</a>
          }

          @default {
            <div class="join__icon" [style.background]="'var(--surface-brand)'">{{ preview()?.groupIcon }}</div>
            <p class="join__eyebrow">You've been invited to join</p>
            <h1>{{ preview()?.groupName }}</h1>
            <p class="join__role">
              as <strong>{{ roleText() }}</strong>
              — {{ preview()?.role === 'editor' ? 'you can create and edit notes and tasks.' : 'you can view and comment.' }}
            </p>

            @if (status() === 'error') {
              <p class="join__error">{{ errorMsg() }}</p>
            }

            <div class="join__actions">
              <a routerLink="/groups" class="btn-ghost">Not now</a>
              <button class="btn-primary" (click)="join()" [disabled]="status() === 'joining'">
                {{ status() === 'joining' ? 'Joining…' : 'Join group' }}
              </button>
            </div>
          }
        }
      </div>
    </div>
  `,
  styleUrl: './join-group.component.scss'
})
export class JoinGroupComponent implements OnInit {
  token = input.required<string>();

  private readonly groups = inject(GroupService);
  private readonly router = inject(Router);

  readonly status   = signal<JoinStatus>('loading');
  readonly preview  = signal<{ groupName: string; groupIcon: string; role: 'editor' | 'viewer' } | null>(null);
  readonly errorMsg = signal('');

  roleText = (): string => {
    const r = this.preview()?.role;
    return r ? ROLE_LABELS[r] : '';
  };

  async ngOnInit(): Promise<void> {
    const p = await this.groups.previewInvite(this.token());
    if (!p) { this.status.set('invalid'); return; }
    this.preview.set(p);
    this.status.set('ready');
  }

  async join(): Promise<void> {
    this.status.set('joining');
    try {
      const res = await this.groups.joinByToken(this.token());
      await this.router.navigate(['/groups', res.groupId]);
    } catch (e: unknown) {
      const httpErr = e as { error?: { error?: string }; message?: string };
      this.errorMsg.set(httpErr?.error?.error ?? httpErr?.message ?? 'Could not join the group.');
      this.status.set('error');
    }
  }
}
