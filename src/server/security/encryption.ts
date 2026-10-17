import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
} from 'node:crypto';
import { getConfig } from '@/server/config';
function key() {
  return Buffer.from(getConfig().TOKEN_ENCRYPTION_KEY, 'hex');
}
export function encryptToken(value: string, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
export function decryptToken(value: string, purpose: string) {
  try {
    const [version, iv, tag, data, ...extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !data || extra.length)
      throw new Error();
    const nonce = Buffer.from(iv, 'base64url'),
      authTag = Buffer.from(tag, 'base64url');
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(), nonce);
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('INVALID_TOKEN');
  }
}

/** Детерминированное authenticated encryption только для высокоэнтропийного session token: сохраняет точный lookup без plaintext в БД. */
export function encryptSessionLookup(value: string) {
  const purpose = 'session-storage';
  const iv = createHmac('sha256', key())
    .update(`${purpose}\0${value}`)
    .digest()
    .subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
