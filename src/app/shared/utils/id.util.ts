// ============================================================
// ID helpers — dependency-free unique id / token generation
// (shared version of the nanoid shim previously inlined in TaskService)
// ============================================================

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Compact random id, ~21 chars by default. Not cryptographically secure. */
export function nanoid(size = 21): string {
  let id = '';
  for (let i = 0; i < size; i++) {
    id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return id;
}

/** Longer random token for invite links (doc id doubles as the secret). */
export function inviteToken(): string {
  return nanoid(28);
}

/**
 * Readable-but-unguessable document id: a slug from `name` plus a short
 * random suffix. e.g. "Marketing Team" -> "marketing-team-x7k2".
 * The suffix keeps ids collision-safe and non-enumerable in URLs.
 */
export function slugId(name: string, suffixSize = 4): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip accents
    .replace(/[^a-z0-9]+/g, '-')                        // non-alphanumeric -> hyphen
    .replace(/^-+|-+$/g, '')                            // trim leading/trailing hyphens
    .slice(0, 40) || 'group';                           // cap length; fallback if empty
  return `${slug}-${nanoid(suffixSize)}`;
}
