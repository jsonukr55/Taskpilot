import { Injectable, signal } from '@angular/core';

// ============================================================
// DialogService — app-wide custom confirm / prompt dialogs, replacing the
// browser's native confirm()/alert()/prompt(). Returns a Promise so call
// sites read like `if (await dialog.confirm({...})) { ... }`.
// A single <tp-app-dialog> (mounted at the app root) renders the request.
// ============================================================

export interface ConfirmOptions {
  title?:       string;
  message:      string;
  confirmText?: string;
  cancelText?:  string;
  danger?:      boolean;
}

export interface PromptOptions {
  title?:       string;
  message?:     string;
  placeholder?: string;
  value?:       string;
  confirmText?: string;
  cancelText?:  string;
}

export interface DialogRequest {
  kind:        'confirm' | 'prompt';
  title?:      string;
  message?:    string;
  confirmText: string;
  cancelText:  string;
  danger:      boolean;
  placeholder?: string;
  value?:      string;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly request = signal<DialogRequest | null>(null);
  private resolver?: (value: any) => void;

  confirm(opts: ConfirmOptions): Promise<boolean> {
    this.request.set({
      kind: 'confirm',
      title: opts.title,
      message: opts.message,
      confirmText: opts.confirmText ?? 'Confirm',
      cancelText: opts.cancelText ?? 'Cancel',
      danger: opts.danger ?? false,
    });
    return new Promise<boolean>(res => (this.resolver = res));
  }

  prompt(opts: PromptOptions): Promise<string | null> {
    this.request.set({
      kind: 'prompt',
      title: opts.title,
      message: opts.message,
      confirmText: opts.confirmText ?? 'OK',
      cancelText: opts.cancelText ?? 'Cancel',
      danger: false,
      placeholder: opts.placeholder ?? '',
      value: opts.value ?? '',
    });
    return new Promise<string | null>(res => (this.resolver = res));
  }

  /** Resolve the open dialog. `value` is boolean for confirm, string|null for prompt. */
  respond(value: boolean | string | null): void {
    this.request.set(null);
    const r = this.resolver;
    this.resolver = undefined;
    r?.(value);
  }
}
