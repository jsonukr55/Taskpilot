import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { AuthService } from './auth.service';
import { Note, NoteQuickRef, NoteAccessState, emptyNoteAccess } from '@shared/models/note.model';

// ============================================================
// NoteAccessService
// ------------------------------------------------------------
// Per-user note quick-access: Favorite, Pin, and Recently Opened.
//
// Storage: users/{uid}.noteAccess (via AuthService.updateNoteAccess).
// This is deliberate — NOT on the note documents — because:
//  • group-note VIEWERS can't write group note docs (rules), but every
//    signed-in user can always write their own profile;
//  • writing a note doc stamps updatedAt/updatedBy, so starring a note
//    would spuriously reorder recency-sorted lists for everyone.
//
// Refs carry a {title, icon} snapshot so Quick Access can render
// favorites across personal AND group notes without extra Firestore
// reads; snapshots refresh whenever the note is opened or re-toggled.
//
// Mutations are optimistic: local signal state updates instantly and
// the profile write happens in the background (last-writer-wins across
// tabs — same trade-off as updatePreferences).
// ============================================================

const RECENT_LIMIT = 10;

@Injectable({ providedIn: 'root' })
export class NoteAccessService {
  private readonly auth = inject(AuthService);

  private readonly state = signal<NoteAccessState>(emptyNoteAccess());
  private seededUid: string | null = null;

  readonly favorites = computed(() => this.state().favorites);
  readonly pinned    = computed(() => this.state().pinned);
  /** Recently opened notes, newest first (capped at 10). */
  readonly recent    = computed(() => this.state().recent);

  private readonly favoriteIds = computed(() => new Set(this.state().favorites.map(r => r.id)));
  private readonly pinnedIds   = computed(() => new Set(this.state().pinned.map(r => r.id)));

  readonly hasQuickAccess = computed(() =>
    this.state().favorites.length > 0 ||
    this.state().pinned.length > 0 ||
    this.state().recent.length > 0
  );

  constructor() {
    // Seed local state from the profile once per signed-in user; clear on
    // sign-out. Later profile patches echo our own writes, so no re-seed.
    effect(() => {
      const uid     = this.auth.userId();
      const profile = this.auth.userProfile();
      if (!uid) {
        this.seededUid = null;
        this.state.set(emptyNoteAccess());
        return;
      }
      if (uid !== this.seededUid && profile?.uid === uid) {
        this.seededUid = uid;
        this.state.set(normalize(profile.noteAccess));
      }
    }, { allowSignalWrites: true });
  }

  isFavorite(noteId: string): boolean { return this.favoriteIds().has(noteId); }
  isPinned(noteId: string): boolean   { return this.pinnedIds().has(noteId); }

  toggleFavorite(note: Note): void { this.toggle('favorites', note); }
  togglePin(note: Note): void      { this.toggle('pinned', note); }

  /** Record that a note was opened (call once per editor visit). */
  recordOpen(note: Note): void {
    const ref = this.toRef(note);
    this.state.update(s => ({
      ...refreshSnapshots(s, ref),
      recent: [ref, ...s.recent.filter(r => r.id !== note.id)].slice(0, RECENT_LIMIT),
    }));
    void this.persist();
  }

  /** Drop a (deleted) note from favorites, pins and recents. */
  forget(noteId: string): void {
    const s = this.state();
    const had = s.favorites.some(r => r.id === noteId)
             || s.pinned.some(r => r.id === noteId)
             || s.recent.some(r => r.id === noteId);
    if (!had) return;
    this.state.set({
      favorites: s.favorites.filter(r => r.id !== noteId),
      pinned:    s.pinned.filter(r => r.id !== noteId),
      recent:    s.recent.filter(r => r.id !== noteId),
    });
    void this.persist();
  }

  // ---- Internals --------------------------------------------------------

  private toggle(list: 'favorites' | 'pinned', note: Note): void {
    const ref = this.toRef(note);
    this.state.update(s => {
      const cur  = s[list];
      const next = cur.some(r => r.id === note.id)
        ? cur.filter(r => r.id !== note.id)
        : [ref, ...cur];
      return { ...s, [list]: next };
    });
    void this.persist();
  }

  /** Build a ref with a display snapshot. All values defined (Firestore rejects undefined). */
  private toRef(note: Note): NoteQuickRef {
    return {
      id:      note.id,
      groupId: note.groupId ?? null,
      title:   note.title || 'Untitled',
      icon:    note.icon ?? null,
      at:      Date.now(),
    };
  }

  private async persist(): Promise<void> {
    try {
      await this.auth.updateNoteAccess(this.state());
    } catch (e) {
      console.warn('[NoteAccess] persist failed', e);
    }
  }
}

/** Tolerate older profiles that lack the field (or parts of it). */
function normalize(a?: NoteAccessState): NoteAccessState {
  return {
    favorites: a?.favorites ?? [],
    pinned:    a?.pinned ?? [],
    recent:    a?.recent ?? [],
  };
}

/** Refresh the {title, icon} snapshot of `ref`'s note across all lists. */
function refreshSnapshots(s: NoteAccessState, ref: NoteQuickRef): NoteAccessState {
  const patch = (r: NoteQuickRef) => r.id === ref.id ? { ...r, title: ref.title, icon: ref.icon } : r;
  return {
    favorites: s.favorites.map(patch),
    pinned:    s.pinned.map(patch),
    recent:    s.recent.map(patch),
  };
}
