// ============================================================
// Universal Search Models
// ------------------------------------------------------------
// A single result shape across every searchable entity (tasks,
// notes, groups, categories, users, daily reports, calendar), plus
// the categorized section grouping the dropdown renders.
// ============================================================

export type SearchCategory =
  | 'task' | 'note' | 'group' | 'category' | 'user' | 'report' | 'calendar';

export interface SearchResult {
  id:        string;
  category:  SearchCategory;
  title:     string;
  subtitle?: string;
  /** Entity emoji (group/category/note icon), rendered as text when present. */
  emoji?:    string;
  /** tp-icon fallback when there's no emoji. */
  icon:      string;
  /** Navigation target. */
  route:     string[];
  queryParams?: Record<string, string>;
  /** Fuzzy-match score (higher = better). */
  score:     number;
}

export interface SearchSection {
  category: SearchCategory;
  label:    string;
  icon:     string;   // tp-icon name for the section header
  results:  SearchResult[];
}

// ---- Fuzzy matcher -------------------------------------------------

/**
 * Score how well `query` matches `text`. Returns 0 for no match.
 * Substring matches rank above subsequence (fuzzy) matches, with bonuses
 * for prefix / word-boundary / consecutive hits.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = (text ?? '').toLowerCase();
  if (!q || !t) return 0;

  // Substring match — strongest signal.
  const idx = t.indexOf(q);
  if (idx >= 0) {
    let score = 100 - Math.min(idx, 60);
    if (t === q) score += 100;                            // exact
    if (idx === 0) score += 40;                           // prefix
    else if (/\s/.test(t[idx - 1])) score += 20;          // word start
    return score;
  }

  // Subsequence (fuzzy) match — every query char appears in order.
  let ti = 0, qi = 0, score = 0, run = 0, prev = -2;
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      score += 1;
      if (prev === ti - 1) { run++; score += run * 2; } else run = 0;
      if (ti === 0 || /\s/.test(t[ti - 1])) score += 3;   // word boundary
      prev = ti;
      qi++;
    }
    ti++;
  }
  return qi === q.length ? Math.max(1, score) : 0;
}

/** Best score across a primary field (full weight) and secondary text (¾). */
export function scoreEntity(query: string, primary: string, secondary = ''): number {
  const p = fuzzyScore(query, primary);
  const s = secondary ? fuzzyScore(query, secondary) * 0.75 : 0;
  return Math.max(p, s);
}
