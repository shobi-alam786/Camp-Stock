/**
 * Access gate for IOM Stock Records.
 * Only a salted SHA-256 hash of the password is kept in the app, not the password itself.
 * This is a casual lock: it hides the screen from ordinary users, it does not stop someone
 * who can take the app apart. The Kobo API token is the real secret and is never in the source.
 */
const PASSWORD_HASH = '00418d850403533c52ffff0a6a77c0808f011baa20e83557d15ca4bcc3374d2b';
const SALT = 'campstock-iom';
const K_FAILS = 'campstock_iom_fails';
const K_LOCK = 'campstock_iom_lock_until';
const K_SERVER = 'campstock_iom_server';
const K_UID = 'campstock_iom_uid';
const K_TOKEN = 'campstock_iom_token';
const MAX_FAILS = 5;
const LOCK_SECONDS = 60;

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const del = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function iomLockedSeconds(): number {
  return Math.max(0, Math.ceil((Number(get(K_LOCK) || 0) - Date.now()) / 1000));
}

export async function verifyIomPassword(pw: string): Promise<{ ok: boolean; lockedSeconds: number; attemptsLeft: number }> {
  const locked = iomLockedSeconds();
  if (locked > 0) return { ok: false, lockedSeconds: locked, attemptsLeft: 0 };
  let ok = false;
  try { ok = (await sha256Hex(`${SALT}:${pw}`)) === PASSWORD_HASH; } catch { ok = false; }
  if (ok) { del(K_FAILS); del(K_LOCK); return { ok: true, lockedSeconds: 0, attemptsLeft: MAX_FAILS }; }
  const fails = Number(get(K_FAILS) || 0) + 1;
  if (fails >= MAX_FAILS) {
    put(K_LOCK, String(Date.now() + LOCK_SECONDS * 1000));
    del(K_FAILS);
    return { ok: false, lockedSeconds: LOCK_SECONDS, attemptsLeft: 0 };
  }
  put(K_FAILS, String(fails));
  return { ok: false, lockedSeconds: 0, attemptsLeft: MAX_FAILS - fails };
}

export interface IomSettings { server: string; uid: string; token: string }

export function loadIomSettings(defaults: { server: string; uid: string }): IomSettings {
  return { server: get(K_SERVER) || defaults.server, uid: get(K_UID) || defaults.uid, token: get(K_TOKEN) || '' };
}

export function saveIomSettings(s: IomSettings): void {
  put(K_SERVER, s.server.trim());
  put(K_UID, s.uid.trim());
  put(K_TOKEN, s.token.trim());
}
