import {
  Component, input, output, signal, inject, ElementRef, HostListener, booleanAttribute,
} from '@angular/core';
import { EntityAvatarComponent } from '@shared/components/entity-avatar/entity-avatar.component';
import { IconComponent } from '@shared/components/icon/icon.component';
import { IconPickerComponent } from '@shared/components/icon-picker/icon-picker.component';
import { LogoKind } from '@core/services/logo.service';

// ============================================================
// tp-avatar-picker — the entity avatar, clickable to change it.
//
// Click the avatar and the emoji library / upload panel opens anchored to
// it, the way Notion does page icons. This is the component screens should
// reach for: <tp-icon-picker> is the panel body and isn't meant to be
// placed directly in a form.
//
// Set [editable]="false" and it degrades to a plain, non-interactive avatar,
// so a list can render the same tag for members and managers alike.
// ============================================================

@Component({
  selector: 'tp-avatar-picker',
  standalone: true,
  imports: [EntityAvatarComponent, IconComponent, IconPickerComponent],
  templateUrl: './avatar-picker.component.html',
  styleUrl: './avatar-picker.component.scss',
})
export class AvatarPickerComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly icon     = input('📁');
  readonly iconUrl  = input<string | null>(null);
  readonly color    = input('#6366f1');
  readonly kind     = input.required<LogoKind>();
  readonly entityId = input<string | null>(null);
  readonly size     = input(48);
  readonly editable = input(true, { transform: booleanAttribute });
  readonly label    = input('Change icon');

  readonly iconChange    = output<string>();
  readonly iconUrlChange = output<string | null>();
  readonly fileSelected  = output<File | null>();

  readonly open = signal(false);
  /** Flip flags, set on open so the panel never lands off-screen. */
  readonly up    = signal(false);
  readonly right = signal(false);

  toggle(): void {
    if (!this.editable()) return;
    if (this.open()) { this.open.set(false); return; }
    this.position();
    this.open.set(true);
  }

  /**
   * The panel is absolutely positioned against this host. Anchor it below-left
   * by default, and flip when the viewport doesn't have room — cheaper than
   * the fixed-position machinery in tp-select, and sufficient because nothing
   * here lives inside an overflow-clipped scroller.
   */
  private position(): void {
    const r = this.host.nativeElement.getBoundingClientRect();
    const PANEL_H = 420, PANEL_W = 340;
    this.up.set(window.innerHeight - r.bottom < PANEL_H && r.top > window.innerHeight - r.bottom);
    this.right.set(r.left + PANEL_W > window.innerWidth - 8);
  }

  onIcon(e: string): void {
    this.iconChange.emit(e);
    this.open.set(false);      // picking an emoji is a complete choice — close
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.open.set(false); }
}
