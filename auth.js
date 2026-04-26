const PBKDF2_ITER = 100000;
const SALT_LEN = 16;
const KEY_BITS = 256;

/**
 * @param {string} plain
 * @returns {Promise<string>} строка v1$… для поля passwordHash
 */
export async function hashPassword(plain) {
  const s = (plain ?? '').trim();
  if (!s) throw new Error('Пустой пароль');
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // TODO: при невозможности хеширования (очень старый браузер) не хранить пароль — регистрация/сброс должны прерваться с ошибкой
    throw new Error('Хеширование недоступно');
  }
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'PBKDF2' }, false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER },
    keyMaterial,
    KEY_BITS
  );
  const hashU8 = new Uint8Array(bits);
  return [
    'v1',
    b64(salt),
    String(PBKDF2_ITER),
    b64(hashU8),
  ].join('$');
}

/**
 * @param {string} plain
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plain, stored) {
  const s = (plain ?? '').trim();
  if (!s || !stored || typeof stored !== 'string') return false;
  if (typeof crypto === 'undefined' || !crypto.subtle) return false;
  const parts = stored.split('$');
  if (parts[0] !== 'v1' || parts.length !== 4) return false;
  const salt = b64d(parts[1]);
  const it = parseInt(parts[2], 10);
  if (!Number.isFinite(it) || it < 1) return false;
  const expectedB64 = parts[3];
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'PBKDF2' }, false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it },
    keyMaterial,
    KEY_BITS
  );
  return b64(new Uint8Array(bits)) === expectedB64;
}

function b64(u8) {
  let s = '';
  u8.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function b64d(b) {
  const s = atob(b);
  const o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) o[i] = s.charCodeAt(i);
  return o;
}
