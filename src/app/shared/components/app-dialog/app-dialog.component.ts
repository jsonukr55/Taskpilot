import { Component, inject, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogService } from '@core/services/dialog.service';
import { IconComponent } from '../icon/icon.component';

// ============================================================
// AppDialogComponent — renders the current DialogService request as a
// custom modal (confirm or prompt). Mounted once at the app root.
// ============================================================
@Component({
  selector:   'tp-app-dialog',
  standalone: true,
  imports:    [FormsModule, IconComponent],
  template: `
    @if (svc.request(); as r) {
      <div class="modal-backdrop" (click)="cancel()">
        <div class="modal scale-in app-dialog" (click)="$event.stopPropagation()">
          <div class="modal__header">
            <h2>{{ r.title || (r.kind === 'prompt' ? 'Enter a value' : 'Please confirm') }}</h2>
            <button class="btn-icon" (click)="cancel()"><tp-icon name="x" [size]="18" /></button>
          </div>
          <div class="modal__body">
            @if (r.message) { <p class="app-dialog__msg">{{ r.message }}</p> }
            @if (r.kind === 'prompt') {
              <input #promptInput class="form-input" [placeholder]="r.placeholder || ''"
                     [ngModel]="text()" (ngModelChange)="text.set($event)"
                     (keydown.enter)="ok()" (keydown.escape)="cancel()">
            }
            <div class="modal__footer">
              <button class="btn-ghost" (click)="cancel()">{{ r.cancelText }}</button>
              <button [class]="r.danger ? 'btn-danger' : 'btn-primary'" (click)="ok()">{{ r.confirmText }}</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .app-dialog { max-width: 420px; }
    .app-dialog__msg {
      font-size: var(--fs, 0.9375rem);
      color: var(--text-secondary);
      line-height: 1.5;
      white-space: pre-wrap;
    }
  `]
})
export class AppDialogComponent {
  readonly svc = inject(DialogService);
  readonly text = signal('');

  constructor() {
    // Seed the prompt input with any default value each time a request opens,
    // and focus it.
    effect(() => {
      const r = this.svc.request();
      if (r?.kind === 'prompt') {
        this.text.set(r.value ?? '');
        setTimeout(() => (document.querySelector('.app-dialog input') as HTMLInputElement)?.focus(), 0);
      }
    });
  }

  ok(): void {
    const r = this.svc.request();
    if (!r) return;
    this.svc.respond(r.kind === 'prompt' ? this.text() : true);
  }
  cancel(): void {
    const r = this.svc.request();
    if (!r) return;
    this.svc.respond(r.kind === 'prompt' ? null : false);
  }
}
