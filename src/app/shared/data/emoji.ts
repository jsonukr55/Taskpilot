// ============================================================
// Emoji library for the entity icon picker.
//
// The full set — all 1,914 Unicode emoji in their 9 official groups — comes
// from `unicode-emoji-json`. That JSON is ~420 KB, far too much for the main
// bundle, so it is pulled in with a dynamic import(): the bundler emits it as
// its own lazy chunk that is fetched the first time a picker is opened, then
// cached in-module for the rest of the session.
//
// SUGGESTED is a small hand-picked set that renders instantly while that
// chunk is in flight. It leads with the glyphs that actually suit a client /
// org / space / group avatar, so the common case needs no scrolling and no
// waiting.
//
// Search matches the Unicode short name ("grinning face with big eyes"), so
// "rocket", "money" and "bug" all resolve the way a user expects.
// ============================================================

export interface EmojiEntry {
  /** The emoji glyph itself. */
  e: string;
  /** Lowercase, space-separated search text (the Unicode short name). */
  k: string;
}

export interface EmojiGroup {
  name: string;
  emojis: EmojiEntry[];
}

/** Instant, curated set for entity avatars — shown above the full library. */
export const SUGGESTED: EmojiGroup = {
  name: 'Suggested',
  emojis: [
    { e: '🏢', k: 'office building company organization headquarters' },
    { e: '🏦', k: 'bank finance money building' },
    { e: '🏭', k: 'factory industry manufacturing plant' },
    { e: '🏗️', k: 'building construction crane site' },
    { e: '💼', k: 'briefcase business work portfolio job' },
    { e: '📁', k: 'file folder directory space' },
    { e: '🗂️', k: 'card index dividers organize files' },
    { e: '📊', k: 'bar chart analytics data report stats' },
    { e: '📈', k: 'chart increasing growth up revenue' },
    { e: '📋', k: 'clipboard tasks list todo checklist' },
    { e: '📝', k: 'memo note write document edit' },
    { e: '📅', k: 'calendar date schedule planning' },
    { e: '🚀', k: 'rocket launch startup deploy fast' },
    { e: '💻', k: 'laptop computer engineering dev code' },
    { e: '⚙️', k: 'gear settings config engineering ops' },
    { e: '🛠️', k: 'hammer and wrench tools build fix' },
    { e: '🧩', k: 'puzzle piece integration module plugin' },
    { e: '🌐', k: 'globe with meridians web internet network' },
    { e: '🐛', k: 'bug defect issue error problem' },
    { e: '🧪', k: 'test tube qa testing experiment lab' },
    { e: '🔬', k: 'microscope research science analysis' },
    { e: '🤖', k: 'robot bot ai automation machine' },
    { e: '🧠', k: 'brain ai intelligence thinking ml' },
    { e: '🛡️', k: 'shield security protection defense' },
    { e: '🔐', k: 'locked with key security auth access' },
    { e: '☁️', k: 'cloud hosting infrastructure saas' },
    { e: '🎯', k: 'bullseye target goal objective okr' },
    { e: '⭐', k: 'star favorite featured rating' },
    { e: '🔥', k: 'fire hot urgent trending priority' },
    { e: '⚡', k: 'high voltage lightning fast energy' },
    { e: '💡', k: 'light bulb idea insight innovation' },
    { e: '🏆', k: 'trophy win award achievement success' },
    { e: '👑', k: 'crown premium vip owner' },
    { e: '💎', k: 'gem stone diamond premium quality' },
    { e: '📣', k: 'megaphone announce marketing broadcast' },
    { e: '👥', k: 'busts in silhouette people group team' },
    { e: '🤝', k: 'handshake deal partnership client' },
    { e: '💰', k: 'money bag finance sales revenue' },
    { e: '🎨', k: 'artist palette art design creative brand' },
    { e: '🗺️', k: 'world map roadmap plan navigation' },
    { e: '🧭', k: 'compass direction navigation explore' },
    { e: '📦', k: 'package box shipping release product' },
    { e: '🌱', k: 'seedling growth new start sprout' },
    { e: '🏠', k: 'house home personal residence' },
  ],
};

interface RawGroup {
  name: string;
  emojis: { emoji: string; name: string }[];
}

let cache: EmojiGroup[] | null = null;
let inflight: Promise<EmojiGroup[]> | null = null;

/**
 * The complete library: SUGGESTED followed by every Unicode group.
 * Resolves immediately once loaded; concurrent callers share one fetch.
 */
export function loadEmojiGroups(): Promise<EmojiGroup[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= import('unicode-emoji-json/data-by-group.json')
    .then(mod => {
      const raw = ((mod as any).default ?? mod) as RawGroup[];
      cache = [
        SUGGESTED,
        ...raw.map(g => ({
          name: g.name,
          emojis: g.emojis.map(x => ({ e: x.emoji, k: x.name.toLowerCase() })),
        })),
      ];
      return cache;
    })
    .catch(() => {
      // Offline or chunk failed — the curated set still gives a usable picker.
      cache = [SUGGESTED];
      return cache;
    });
  return inflight;
}

/**
 * Filter groups by a free-text query, matched against each emoji's name.
 * An empty query returns the groups unchanged; groups that match nothing are
 * dropped so the grid never renders an empty heading.
 */
export function searchEmojiGroups(groups: EmojiGroup[], query: string): EmojiGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const terms = q.split(/\s+/);
  return groups
    // Every suggested glyph also lives in a Unicode group, so keeping the
    // shortcut list while searching would just show each hit twice.
    .filter(g => g !== SUGGESTED)
    .map(g => ({
      name: g.name,
      emojis: g.emojis.filter(x => terms.every(t => x.k.includes(t) || x.e === t)),
    }))
    .filter(g => g.emojis.length > 0);
}
