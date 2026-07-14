import { Component, inject } from '@angular/core';
import { ToastService } from '@core/services/toast.service';
import { IconComponent } from '@shared/components/icon/icon.component';

// ============================================================
// ToastComponent — renders the toast stack. Mount once in the shell.
// ============================================================

@Component({
  selector:   'tp-toast',
  standalone: true,
  imports:    [IconComponent],
  template: `
    <div class="toast-host" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [class]="'toast--' + t.kind" role="status">
          <tp-icon
            [name]="t.kind === 'success' ? 'check-circle' : t.kind === 'error' ? 'alert-circle' : 'circle'"
            [size]="16" />
          <span class="toast__text">{{ t.text }}</span>
          <button class="toast__close" (click)="toasts.dismiss(t.id)" aria-label="Dismiss">
            <tp-icon name="x" [size]="14" />
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './toast.component.scss'
})
export class ToastComponent {
  readonly toasts = inject(ToastService);
}
