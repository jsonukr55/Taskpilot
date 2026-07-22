import { Injectable, inject, signal, computed } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { Category, DEFAULT_CATEGORIES } from '@shared/models/category.model';
import { toTs } from './supabase-map.util';

// ============================================================
// CategoryService — user-isolated categories (Supabase + realtime).
// Same public API as the Firestore version; internals swapped.
// ============================================================
@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly supa = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  readonly categories = signal<Category[]>([]);
  readonly isLoading  = signal(true);

  readonly rootCategories = computed(() =>
    this.categories().filter(c => !c.parentId).sort((a, b) => a.order - b.order)
  );

  childrenOf = (parentId: string) =>
    computed(() => this.categories().filter(c => c.parentId === parentId));

  readonly categoryMap = computed(() =>
    new Map(this.categories().map(c => [c.id, c]))
  );

  getCategoryById(id: string): Category | undefined {
    return this.categoryMap().get(id);
  }

  getAncestors(categoryId: string): Category[] {
    const map = this.categoryMap();
    const result: Category[] = [];
    let current = map.get(categoryId);
    while (current?.parentId) {
      const parent = map.get(current.parentId);
      if (parent) result.unshift(parent);
      current = parent;
    }
    return result;
  }

  private channel?: RealtimeChannel;
  private seeded = false;

  // ---- Lifecycle ----

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;

    void this.load(uid, true);
    this.channel = this.supa.client
      .channel(`categories:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: `user_id=eq.${uid}` },
        () => void this.load(uid, false))
      .subscribe();
  }

  stopListening(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
  }

  private async load(uid: string, first: boolean): Promise<void> {
    const { data } = await this.supa.db('categories').select('*').eq('user_id', uid).order('order');
    this.categories.set((data ?? []).map(rowToCategory));
    this.isLoading.set(false);
    // Seed defaults once, on first empty load (mirrors the old behavior).
    if (first && !this.seeded && (data ?? []).length === 0) {
      this.seeded = true;
      void this.seedDefaults();
    }
  }

  // ---- CRUD ----

  async create(data: Omit<Category, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');
    const { data: row, error } = await this.supa.db('categories').insert({
      user_id:     uid,
      name:        data.name,
      description: data.description ?? null,
      icon:        data.icon,
      color:       data.color,
      parent_id:   data.parentId ?? null,
      keywords:    data.keywords ?? [],
      rules:       data.rules,
      order:       data.order,
    }).select('id').single();
    if (error) throw error;
    return row.id;
  }

  async update(id: string, changes: Partial<Category>): Promise<void> {
    await this.supa.db('categories').update(categoryPatch(changes)).eq('id', id);
  }

  async delete(id: string): Promise<void> {
    await this.supa.rpc('remove_category', { p_id: id });
  }

  /** Seed default categories for a new user. */
  async seedDefaults(): Promise<void> {
    const uid = this.auth.userId();
    if (!uid) return;
    const rows = DEFAULT_CATEGORIES.map(cat => ({
      user_id:     uid,
      name:        cat.name,
      description: (cat as any).description ?? null,
      icon:        cat.icon,
      color:       cat.color,
      parent_id:   cat.parentId ?? null,
      keywords:    cat.keywords ?? [],
      rules:       cat.rules,
      order:       cat.order,
    }));
    await this.supa.db('categories').insert(rows);
  }

  /** Auto-detect category from task text using keyword matching. */
  detectCategory(text: string): Category | null {
    const lower = text.toLowerCase();
    let bestMatch: Category | null = null;
    let bestScore = 0;
    for (const cat of this.categories()) {
      if (!cat.keywords?.length) continue;
      const score = cat.keywords.filter(kw => lower.includes(kw)).length;
      if (score > bestScore) { bestScore = score; bestMatch = cat; }
    }
    return bestScore > 0 ? bestMatch : null;
  }

  async reorder(orderedIds: string[]): Promise<void> {
    await Promise.all(orderedIds.map((id, index) =>
      this.supa.db('categories').update({ order: index }).eq('id', id)
    ));
  }
}

// ---- Mapping ----

function rowToCategory(r: any): Category {
  return {
    id:          r.id,
    userId:      r.user_id,
    name:        r.name,
    description: r.description ?? undefined,
    icon:        r.icon,
    color:       r.color,
    parentId:    r.parent_id ?? null,
    keywords:    r.keywords ?? [],
    rules:       r.rules,
    order:       r.order,
    createdAt:   toTs(r.created_at) as any,
    updatedAt:   toTs(r.updated_at) as any,
  };
}

function categoryPatch(c: Partial<Category>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (c.name        !== undefined) p['name'] = c.name;
  if (c.description !== undefined) p['description'] = c.description;
  if (c.icon        !== undefined) p['icon'] = c.icon;
  if (c.color       !== undefined) p['color'] = c.color;
  if (c.parentId    !== undefined) p['parent_id'] = c.parentId;
  if (c.keywords    !== undefined) p['keywords'] = c.keywords;
  if (c.rules       !== undefined) p['rules'] = c.rules;
  if (c.order       !== undefined) p['order'] = c.order;
  return p;
}
