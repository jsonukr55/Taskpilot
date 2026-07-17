import { Component, inject, computed } from '@angular/core';
import { KeyboardShortcutService } from '@core/services/keyboard-shortcut.service';
import { ShortcutView } from '@shared/models/keyboard.model';
import { IconComponent } from '../icon/icon.component';

// ============================================================
// KeyboardHelpComponent — a modal listing every documented shortcut,
// grouped, with platform-aware key rendering. Toggled by '?' via the
// KeyboardShortcutService. Rendered once in the shell.
// ============================================================

interface HelpGroup { name: string; items: ShortcutView[]; }

@Component({
  selector: 'tp-keyboard-help',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="kb-help__backdrop" (click)="shortcuts.helpOpen.set(false)"></div>
    <div class="kb-help" role="dialog" aria-label="Keyboard shortcuts">
      <div class="kb-help__head">
        <h2 class="kb-help__title">Keyboard shortcuts</h2>
        <button class="btn-icon" (click)="shortcuts.helpOpen.set(false)" aria-label="Close">
          <tp-icon name="x" [size]="16" />
        </button>
      </div>

      <div class="kb-help__body">
        @for (group of groups(); track group.name) {
          <div class="kb-help__group">
            <p class="kb-help__group-name">{{ group.name }}</p>
            @for (item of group.items; track item.description) {
              <div class="kb-help__row">
                <span class="kb-help__desc">{{ item.description }}</span>
                <span class="kb-help__keys">
                  @for (combo of item.keys; track combo; let last = $last) {
                    <span class="kb-help__combo">
                      @for (k of parts(combo); track k) { <kbd>{{ k }}</kbd> }
                    </span>
                    @if (!last) { <span class="kb-help__or">or</span> }
                  }
                </span>
              </div>
            }
          </div>
        }
        @if (groups().length === 0) {
          <p class="kb-help__empty">No shortcuts available on this screen.</p>
        }
      </div>
    </div>
  `,
  styleUrl: './keyboard-help.component.scss',
})
export class KeyboardHelpComponent {
  readonly shortcuts = inject(KeyboardShortcutService);

  private readonly isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

  readonly groups = computed<HelpGroup[]>(() => {
    const map = new Map<string, ShortcutView[]>();
    for (const s of this.shortcuts.documented()) {
      (map.get(s.group) ?? map.set(s.group, []).get(s.group)!).push(s);
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  });

  /** Split a normalized combo ('mod+shift+k') into display key labels. */
  parts(combo: string): string[] {
    return combo.split('+').map(t => this.keyLabel(t));
  }

  private keyLabel(token: string): string {
    switch (token) {
      case 'mod':        return this.isMac ? '⌘' : 'Ctrl';
      case 'shift':      return this.isMac ? '⇧' : 'Shift';
      case 'alt':        return this.isMac ? '⌥' : 'Alt';
      case 'escape':     return 'Esc';
      case 'enter':      return '↵';
      case 'space':      return 'Space';
      case 'delete':     return 'Del';
      case 'backspace':  return '⌫';
      case 'arrowup':    return '↑';
      case 'arrowdown':  return '↓';
      case 'arrowleft':  return '←';
      case 'arrowright': return '→';
      default:           return token.length === 1 ? token.toUpperCase() : token;
    }
  }
}
