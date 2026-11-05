/**
 * Local PIN lock (4 or 6 digits) for the hidden "clean local records" tool.
 * The PIN is never stored: only a salted hash is kept on this device.
 * This is a local lock. It stops casual use, not someone who controls the computer.
 */
const K_HASH = 'campstock_pin_hash';
const K_SALT = 'campstock_pin_salt';
const K_FAILS = 'campstock_pin_fails';
const K_LOCK = 'campstock_pin_lock_until';
const MAX_FAILS = 5;
const LOCK_SECONDS = 60;

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const del = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export const isValidPin = (pin: string) => /^(\d{4}|\d{6})$/.test(pin);
export const isPinSet = () => !!get(K_HASH);

async function hashPin(salt: string, pin: string): Promise<string> {
  const text = `${salt}:${pin}`;
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through */ }
  // Fallback when the browser has no crypto.subtle (plain http): simple repeated hash.
  let h = 2166136261;
  for (let r = 0; r < 2000; r++) {
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  }
  return `f${h.toString(16)}`;
}

export async function setPin(pin: string): Promise<void> {
  const salt = Array.from(globalThis.crypto?.getRandomValues?.(new Uint8Array(16)) ?? [Date.now() % 251, Math.floor(Math.random() * 251)])
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  put(K_SALT, salt);
  put(K_HASH, await hashPin(salt, pin));
  del(K_FAILS);
  del(K_LOCK);
}

export function lockedSeconds(): number {
  const until = Number(get(K_LOCK) || 0);
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

export async function verifyPin(pin: string): Promise<{ ok: boolean; lockedSeconds: number; attemptsLeft: number }> {
  const locked = lockedSeconds();
  if (locked > 0) return { ok: false, lockedSeconds: locked, attemptsLeft: 0 };
  const expected = get(K_HASH);
  const salt = get(K_SALT) || '';
  if (expected && (await hashPin(salt, pin)) === expected) {
    del(K_FAILS);
    del(K_LOCK);
    return { ok: true, lockedSeconds: 0, attemptsLeft: MAX_FAILS };
  }
  const fails = Number(get(K_FAILS) || 0) + 1;
  if (fails >= MAX_FAILS) {
    put(K_LOCK, String(Date.now() + LOCK_SECONDS * 1000));
    del(K_FAILS);
    return { ok: false, lockedSeconds: LOCK_SECONDS, attemptsLeft: 0 };
  }
  put(K_FAILS, String(fails));
  return { ok: false, lockedSeconds: 0, attemptsLeft: MAX_FAILS - fails };
}
