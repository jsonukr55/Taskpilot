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
