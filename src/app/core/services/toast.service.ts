import { Injectable, signal } from '@angular/core';
import { nanoid } from '@shared/utils/id.util';

// ============================================================
// ToastService — transient feedback messages.
// Signal-based queue; auto-dismiss after a timeout. Rendered by
// <tp-toast /> (mounted once in the shell).
// ============================================================

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id:   string;
  kind: ToastKind;
  text: string;
}

const DEFAULT_MS = 3000;
const ERROR_MS   = 6000;   // errors linger a bit longer

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  private push(kind: ToastKind, text: string, ms: number): void {
    const id = nanoid(8);
    this.toasts.update(list => [...list, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }

  success(text: string, ms = DEFAULT_MS): void { this.push('success', text, ms); }
  error(text: string,   ms = ERROR_MS):   void { this.push('error', text, ms); }
  info(text: string,    ms = DEFAULT_MS): void { this.push('info', text, ms); }

  dismiss(id: string): void {
    this.toasts.update(list => list.filter(t => t.id !== id));
  }
}
