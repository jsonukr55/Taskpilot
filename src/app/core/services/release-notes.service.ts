import { Injectable, signal, computed } from '@angular/core';
import { RELEASE_NOTES, ReleaseNote } from '@features/whats-new/release-notes.data';

// ============================================================
// ReleaseNotesService — serves the "What's New" content and
// tracks whether the user has seen the latest version (a dot
// shows in the sidebar until they open the page).
// ============================================================

@Injectable({ providedIn: 'root' })
export class ReleaseNotesService {
  private static readonly SEEN_KEY = 'taskpilot:whatsNew:lastSeen';

  readonly notes: ReleaseNote[] = RELEASE_NOTES;
  readonly latestVersion = RELEASE_NOTES[0]?.version ?? '';

  private readonly _lastSeen = signal<string | null>(
    localStorage.getItem(ReleaseNotesService.SEEN_KEY)
  );

  /** True when there's a newer version than the user has opened. */
  readonly hasUnseen = computed(() =>
    !!this.latestVersion && this._lastSeen() !== this.latestVersion
  );

  /** Call when the What's New page is opened. */
  markSeen(): void {
    localStorage.setItem(ReleaseNotesService.SEEN_KEY, this.latestVersion);
    this._lastSeen.set(this.latestVersion);
  }
}
