import { Component, input, output, signal, computed, inject, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '@shared/components/icon/icon.component';
import { EntityAvatarComponent } from '@shared/components/entity-avatar/entity-avatar.component';
import { LogoService, LogoKind } from '@core/services/logo.service';
import { EmojiGroup, SUGGESTED, loadEmojiGroups, searchEmojiGroups } from '@shared/data/emoji';

// ============================================================
// tp-icon-picker — pick an entity avatar: a searchable emoji library, or
// upload an image.
//
// Two modes, driven by `entityId`:
//   edit   (entityId set)  — uploads immediately and emits the public URL.
//   create (entityId null) — the row doesn't exist yet, so storage RLS would
//                            reject the write. Instead we keep the File and
//                            emit it via (fileSelected); the parent uploads
//                            after insert and patches icon_url. A local
//                            object URL gives the user a preview meanwhile.
// ============================================================

@Component({
  selector: 'tp-icon-picker',
  standalone: true,
  imports: [FormsModule, IconComponent, EntityAvatarComponent],
  templateUrl: './icon-picker.component.html',
  styleUrl: './icon-picker.component.scss',
})
export class IconPickerComponent implements OnDestroy {
  private readonly logos = inject(LogoService);

  readonly icon     = input('📁');
  readonly iconUrl  = input<string | null>(null);
  readonly color    = input('#6366f1');
  readonly kind     = input.required<LogoKind>();
  /** null while the entity is still being created — see the class comment. */
  readonly entityId = input<string | null>(null);

  readonly iconChange    = output<string>();
  readonly iconUrlChange = output<string | null>();
  readonly fileSelected  = output<File | null>();

  readonly tab      = signal<'emoji' | 'upload'>('emoji');
  readonly query    = signal('');
  readonly busy     = signal(false);
  readonly uploadError = signal<string | null>(null);
  /** Object URL for the create-mode preview; revoked on replace/destroy. */
  private readonly previewUrl = signal<string | null>(null);

  readonly accept = this.logos.accept;

  /** Starts as the curated shortcut list, then swaps in the full library. */
  private readonly library = signal<EmojiGroup[]>([SUGGESTED]);
  readonly loadingLibrary = signal(true);

  readonly groups = computed(() => searchEmojiGroups(this.library(), this.query()));
  readonly noMatches = computed(() => this.groups().length === 0);

  constructor() {
    void loadEmojiGroups().then(groups => {
      this.library.set(groups);
      this.loadingLibrary.set(false);
    });
  }

  /** What the preview avatar shows: pending upload wins over the saved URL. */
  readonly effectiveUrl = computed(() => this.previewUrl() ?? this.iconUrl());
  readonly hasImage = computed(() => !!this.effectiveUrl());

  pickEmoji(e: string): void {
    this.iconChange.emit(e);
    // Choosing an emoji is an explicit "no image" — drop any pending upload
    // so the preview and the saved value can't disagree.
    if (this.hasImage()) this.clearImage();
  }

  async onFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';                       // let the same file be re-picked
    if (!file) return;

    const reason = this.logos.validate(file);
    if (reason) { this.uploadError.set(reason); return; }
    this.uploadError.set(null);

    const id = this.entityId();
    if (!id) {                              // create mode — defer the upload
      this.setPreview(URL.createObjectURL(file));
      this.fileSelected.emit(file);
      return;
    }

    this.busy.set(true);
    try {
      this.iconUrlChange.emit(await this.logos.upload(this.kind(), id, file));
    } catch (e: any) {
      this.uploadError.set(e?.message ?? 'Could not upload that image.');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Revert to the emoji. Note this does NOT delete the stored object: the
   * parent may be a form the user goes on to cancel, which would leave the
   * saved icon_url pointing at something we'd already destroyed. Superseded
   * objects are left orphaned in the bucket — cheap, and never wrong.
   */
  clearImage(): void {
    this.uploadError.set(null);
    this.setPreview(null);
    this.fileSelected.emit(null);
    if (this.iconUrl()) this.iconUrlChange.emit(null);
  }

  private setPreview(url: string | null): void {
    const old = this.previewUrl();
    if (old) URL.revokeObjectURL(old);
    this.previewUrl.set(url);
  }

  ngOnDestroy(): void { this.setPreview(null); }
}
