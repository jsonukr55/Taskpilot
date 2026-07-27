import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NotificationService } from '@core/services/notification.service';
import { IconComponent } from '../icon/icon.component';
import { AppNotification } from '@shared/models/notification.model';

@Component({
  selector:   'tp-notification-bell',
  standalone: true,
  imports:    [IconComponent],
  templateUrl: './notification-bell.component.html',
  styleUrl:    './notification-bell.component.scss'
})
export class NotificationBellComponent {
  readonly notifs = inject(NotificationService);
  private readonly router = inject(Router);

  readonly open = signal(false);

  toggle(): void { this.open.update(v => !v); }
  close(): void { this.open.set(false); }

  timeAgo = (n: AppNotification): string => {
    const d = n.createdAt?.toDate?.();
    if (!d) return '';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return d.toLocaleDateString();
  };

  async onClick(n: AppNotification): Promise<void> {
    if (!n.read) await this.notifs.markRead(n.id);
    this.close();
    if (n.taskId) void this.router.navigate(['/tasks']);
  }

  markAll(): void { void this.notifs.markAllRead(); }
  remove(e: Event, n: AppNotification): void { e.stopPropagation(); void this.notifs.remove(n.id); }
}
