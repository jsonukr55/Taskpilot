import { Component, input, computed, signal } from '@angular/core';

// ============================================================
// tp-entity-avatar — the single way to render a client / org / space /
// group / category avatar.
//
// Shows the uploaded logo when `iconUrl` is set, otherwise the entity's
// emoji on a chip tinted with its color (UI_GUIDELINES §12). Keeping both
// cases here means a screen never has to branch on "uploaded or not".
//
// A logo that fails to load (deleted object, offline) falls back to the
// emoji rather than rendering a broken-image icon.
// ============================================================

@Component({
  selector: 'tp-entity-avatar',
  standalone: true,
  imports: [],
  templateUrl: './entity-avatar.component.html',
  styleUrl: './entity-avatar.component.scss',
})
export class EntityAvatarComponent {
  readonly icon    = input('📁');
  readonly iconUrl = input<string | null>(null);
  readonly color   = input('#6366f1');
  /** Box size in px; the emoji scales with it. */
  readonly size    = input(32);
  /** Rounded square (default) or fully round. */
  readonly round   = input(false);
  /** Drop the tinted chip and render the bare glyph — for dense nav rows. */
  readonly plain   = input(false);
  readonly alt     = input('');

  private readonly failed = signal(false);

  readonly showImage = computed(() => !!this.iconUrl() && !this.failed());

  readonly boxStyle = computed(() => ({
    width:        `${this.size()}px`,
    height:       `${this.size()}px`,
    // A bare emoji reads better a touch larger than one inside a chip.
    'font-size':  `${Math.round(this.size() * (this.plain() && !this.showImage() ? 0.85 : 0.55))}px`,
    'border-radius': this.round() ? '50%' : `${Math.max(6, Math.round(this.size() * 0.28))}px`,
    background:   this.showImage() || this.plain() ? 'transparent' : this.color() + '22',
  }));

  onError(): void { this.failed.set(true); }
}
