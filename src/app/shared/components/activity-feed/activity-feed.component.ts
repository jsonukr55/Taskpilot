import { Component, input, output } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { ActivityEvent } from '@shared/models/activity.model';
import { IconComponent } from '../icon/icon.component';

// ============================================================
// ActivityFeedComponent — reusable renderer for an ActivityEvent[].
// Purely presentational: pass in events (from ActivityService), get
// an (activate) event back when a row is clicked. Drop it into the
// dashboard, a group page, or anywhere a feed is useful.
// ============================================================

@Component({
  selector: 'tp-activity-feed',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (events().length > 0) {
      <ul class="activity-feed">
        @for (e of events(); track e.id) {
          <li class="activity-feed__item" (click)="activate.emit(e)">
            <span class="activity-feed__icon" [class]="'activity-feed__icon--' + e.category">
              <tp-icon [name]="e.icon" [size]="14" />
            </span>
            <span class="activity-feed__text">
              <strong>{{ e.label }}</strong> {{ e.title }}
            </span>
            <span class="activity-feed__time">{{ timeAgo(e.at) }}</span>
          </li>
        }
      </ul>
    } @else {
      <div class="activity-feed__empty">
        <span class="activity-feed__empty-icon">🕓</span>
        <p>{{ emptyText() }}</p>
      </div>
    }
  `,
  styleUrl: './activity-feed.component.scss',
})
export class ActivityFeedComponent {
  readonly events    = input.required<ActivityEvent[]>();
  readonly emptyText = input('No recent activity yet.');
  readonly activate  = output<ActivityEvent>();

  /** Short "x ago" label. */
  timeAgo(ts?: Timestamp | null): string {
    if (!ts) return '';
    const min = Math.round((Date.now() - ts.toMillis()) / 60_000);
    if (min < 1)  return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24)  return `${hr}h ago`;
    const d = Math.round(hr / 24);
    if (d < 7)    return `${d}d ago`;
    return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
