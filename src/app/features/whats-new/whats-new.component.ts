import { Component, inject, OnInit } from '@angular/core';
import { ReleaseNotesService } from '@core/services/release-notes.service';
import { ReleaseNoteType } from './release-notes.data';
import { IconComponent } from '@shared/components/icon/icon.component';

// ============================================================
// WhatsNewComponent — the /whats-new page. Lists version history
// and marks the latest as seen (clears the sidebar "New" dot).
// ============================================================

@Component({
  selector:   'tp-whats-new',
  standalone: true,
  imports:    [IconComponent],
  templateUrl: './whats-new.component.html',
  styleUrl:    './whats-new.component.scss',
})
export class WhatsNewComponent implements OnInit {
  readonly release = inject(ReleaseNotesService);

  readonly typeMeta: Record<ReleaseNoteType, { label: string; icon: string }> = {
    added:    { label: 'New',      icon: 'plus' },
    improved: { label: 'Improved', icon: 'zap' },
    fixed:    { label: 'Fixed',    icon: 'check' },
  };

  ngOnInit(): void {
    this.release.markSeen();
  }
}
