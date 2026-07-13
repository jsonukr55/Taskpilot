import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Firestore, collection, query, where,
  onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, writeBatch, getDocs
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { Category, DEFAULT_CATEGORIES } from '@shared/models/category.model';

// ============================================================
// CategoryService
// ============================================================

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly firestore = inject(Firestore);
  private readonly auth      = inject(AuthService);

  readonly categories  = signal<Category[]>([]);
  readonly isLoading   = signal(true);

  /** Root categories (no parent) */
  readonly rootCategories = computed(() =>
    this.categories().filter(c => !c.parentId).sort((a, b) => a.order - b.order)
  );

  /** Get children of a category */
  childrenOf = (parentId: string) =>
    computed(() => this.categories().filter(c => c.parentId === parentId));

  /** Category map for O(1) lookup */
  readonly categoryMap = computed(() =>
    new Map(this.categories().map(c => [c.id, c]))
  );

  getCategoryById(id: string): Category | undefined {
    return this.categoryMap().get(id);
  }

  /** Get full ancestor path of a category */
  getAncestors(categoryId: string): Category[] {
    const map    = this.categoryMap();
    const result: Category[] = [];
    let current  = map.get(categoryId);
    while (current?.parentId) {
      const parent = map.get(current.parentId);
      if (parent) result.unshift(parent);
      current = parent;
    }
    return result;
  }

  private unsubscribe?: () => void;

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;

    const q = query(
      collection(this.firestore, 'categories'),
      where('userId', '==', uid)
    );

    let firstSnapshot = true;
    this.unsubscribe = onSnapshot(q, snapshot => {
      const cats = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Category));
      this.categories.set(cats);
      this.isLoading.set(false);

      // Seed defaults only on first snapshot if user has no categories
      if (firstSnapshot) {
        firstSnapshot = false;
        if (cats.length === 0) this.seedDefaults();
      }
    });
  }

  stopListening(): void {
    this.unsubscribe?.();
  }

  // ---- CRUD ----

  async create(data: Omit<Category, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const ref = await addDoc(collection(this.firestore, 'categories'), {
      ...data,
      userId:    uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return ref.id;
  }

  async update(id: string, changes: Partial<Category>): Promise<void> {
    await updateDoc(doc(this.firestore, 'categories', id), {
      ...changes,
      updatedAt: serverTimestamp()
    });
  }

  async delete(id: string): Promise<void> {
    // Also remove from all tasks (batch)
    const uid = this.auth.userId();
    if (!uid) return;

    const batch = writeBatch(this.firestore);

    // Get all tasks with this category
    const tasksSnap = await getDocs(query(
      collection(this.firestore, 'tasks'),
      where('userId', '==', uid),
      where('categoryIds', 'array-contains', id)
    ));

    tasksSnap.docs.forEach(taskDoc => {
      const categoryIds = (taskDoc.data()['categoryIds'] as string[]).filter(cid => cid !== id);
      batch.update(taskDoc.ref, { categoryIds, updatedAt: serverTimestamp() });
    });

    // Delete children categories
    const children = this.categories().filter(c => c.parentId === id);
    children.forEach(c => batch.delete(doc(this.firestore, 'categories', c.id)));

    // Delete category
    batch.delete(doc(this.firestore, 'categories', id));

    await batch.commit();
  }

  /** Seed default categories for a new user */
  async seedDefaults(): Promise<void> {
    const uid = this.auth.userId();
    if (!uid || this.categories().length > 0) return;

    const batch = writeBatch(this.firestore);
    DEFAULT_CATEGORIES.forEach(cat => {
      const ref = doc(collection(this.firestore, 'categories'));
      batch.set(ref, {
        ...cat,
        userId:    uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
  }

  /** Auto-detect category from task text using keyword matching */
  detectCategory(text: string): Category | null {
    const lower = text.toLowerCase();
    const categories = this.categories();

    let bestMatch: Category | null = null;
    let bestScore = 0;

    for (const cat of categories) {
      if (!cat.keywords?.length) continue;
      const score = cat.keywords.filter(kw => lower.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = cat;
      }
    }

    return bestScore > 0 ? bestMatch : null;
  }

  reorder(orderedIds: string[]): Promise<void> {
    const batch = writeBatch(this.firestore);
    orderedIds.forEach((id, index) => {
      batch.update(doc(this.firestore, 'categories', id), {
        order: index,
        updatedAt: serverTimestamp()
      });
    });
    return batch.commit();
  }
}
