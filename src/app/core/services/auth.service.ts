import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth, GoogleAuthProvider, signInWithPopup,
  signOut, onAuthStateChanged, User,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile
} from '@angular/fire/auth';
import {
  Firestore, doc, setDoc, getDoc, serverTimestamp
} from '@angular/fire/firestore';
import { UserProfile, DEFAULT_PREFERENCES } from '@shared/models/user.model';
import { NoteAccessState } from '@shared/models/note.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth      = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly router    = inject(Router);

  readonly currentUser     = signal<User | null>(null);
  readonly userProfile     = signal<UserProfile | null>(null);
  readonly isLoading       = signal(true);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly userId          = computed(() => this.currentUser()?.uid ?? null);
  readonly displayName     = computed(() => this.currentUser()?.displayName ?? '');
  readonly photoURL        = computed(() => this.currentUser()?.photoURL ?? null);

  // Resolves after the first onAuthStateChanged callback fully completes
  private _resolveInit!: () => void;
  readonly initialized = new Promise<void>(r => { this._resolveInit = r; });

  constructor() {
    onAuthStateChanged(this.auth, async (user) => {
      this.currentUser.set(user);
      if (user) {
        await this.loadOrCreateProfile(user);
      } else {
        this.userProfile.set(null);
      }
      this.isLoading.set(false);
      this._resolveInit();
    });
  }

  // ---- Sign-in ----

  /** Post-login destination: an authGuard-preserved returnUrl, else the dashboard. */
  private postAuthTarget(): string {
    const returnUrl = this.router.parseUrl(this.router.url).queryParams['returnUrl'];
    return returnUrl && typeof returnUrl === 'string' ? returnUrl : '/dashboard';
  }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(this.auth, provider);
    await this.router.navigateByUrl(this.postAuthTarget());
  }

  async signUpWithEmail(name: string, email: string, password: string): Promise<void> {
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await this.createProfile(cred.user);
    await this.router.navigateByUrl(this.postAuthTarget());
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
    await this.router.navigateByUrl(this.postAuthTarget());
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
    this.userProfile.set(null);
    this.currentUser.set(null);
    await this.router.navigate(['/auth/login']);
  }

  // ---- Profile ----

  private async loadOrCreateProfile(user: User): Promise<void> {
    try {
      const ref  = doc(this.firestore, 'users', user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        this.userProfile.set(snap.data() as UserProfile);
      } else {
        await this.createProfile(user);
      }
    } catch {
      this.userProfile.set({
        uid:         user.uid,
        email:       user.email ?? '',
        displayName: user.displayName ?? 'User',
        photoURL:    user.photoURL ?? null,
        preferences: DEFAULT_PREFERENCES,
        stats: { totalTasks: 0, completedTasks: 0, totalCategories: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: null },
        calendarIntegrations: [],
        seenInsightIds: [],
        createdAt: null as any,
        updatedAt: null as any
      });
    }
  }

  async createProfile(user: User): Promise<void> {
    const ref = doc(this.firestore, 'users', user.uid);
    await setDoc(ref, {
      uid:         user.uid,
      email:       user.email ?? '',
      displayName: user.displayName ?? 'User',
      photoURL:    user.photoURL ?? null,
      preferences: DEFAULT_PREFERENCES,
      stats: { totalTasks: 0, completedTasks: 0, totalCategories: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: null },
      calendarIntegrations: [],
      seenInsightIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    const snap = await getDoc(ref);
    this.userProfile.set(snap.data() as UserProfile);
  }

  async updatePreferences(prefs: Partial<UserProfile['preferences']>): Promise<void> {
    const uid = this.userId();
    if (!uid) return;
    await setDoc(doc(this.firestore, 'users', uid), {
      preferences: { ...this.userProfile()?.preferences, ...prefs },
      updatedAt: serverTimestamp()
    }, { merge: true });
    this.userProfile.update(p => p ? { ...p, preferences: { ...p.preferences, ...prefs } } : null);
  }

  /** Persist the user's note quick-access state (favorites/pins/recents). */
  async updateNoteAccess(access: NoteAccessState): Promise<void> {
    const uid = this.userId();
    if (!uid) return;
    await setDoc(doc(this.firestore, 'users', uid), {
      noteAccess: access,
      updatedAt: serverTimestamp()
    }, { merge: true });
    this.userProfile.update(p => p ? { ...p, noteAccess: access } : null);
  }
}
