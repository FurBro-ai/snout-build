import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateTotpSecret(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += BASE32_ALPHABET[bytes[i] % 32];
  }
  return result;
}

function base32ToBuffer(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of cleaned) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, windowOffset = 0, stepSeconds = 30): string {
  const key = base32ToBuffer(secret);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds) + windowOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, '0');
}

export function verifyTotpCode(secret: string, token: string): boolean {
  const normalized = token.replace(/[\s-]+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const offset of [-2, -1, 0, 1, 2]) {
    const expected = generateTotpCode(secret, offset);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(accountLabel: string, secret: string): string {
  const issuer = encodeURIComponent('Snout');
  const account = encodeURIComponent(accountLabel);
  return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function normalizeBackupCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashBackupCode(raw: string): string {
  return crypto.createHash('sha256').update(normalizeBackupCode(raw)).digest('hex');
}

export function generateBackupCodes(count = 8): { plainCodes: string[]; hashes: string[] } {
  const plainCodes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(8);
    let raw = '';
    for (let j = 0; j < 8; j++) {
      raw += BACKUP_ALPHABET[bytes[j] % BACKUP_ALPHABET.length];
    }
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plainCodes.push(formatted);
    hashes.push(hashBackupCode(formatted));
  }
  return { plainCodes, hashes };
}

export function consumeBackupCode(
  storedHashes: string[] | undefined,
  rawCode: string
): { valid: boolean; nextHashes: string[] } {
  if (!storedHashes || storedHashes.length === 0) {
    return { valid: false, nextHashes: [] };
  }
  const normalized = normalizeBackupCode(rawCode);
  if (normalized.length < 6) {
    return { valid: false, nextHashes: storedHashes };
  }
  const candidateHash = hashBackupCode(normalized);
  const idx = storedHashes.findIndex(
    (h) =>
      h.length === candidateHash.length &&
      crypto.timingSafeEqual(Buffer.from(h), Buffer.from(candidateHash))
  );
  if (idx === -1) {
    return { valid: false, nextHashes: storedHashes };
  }
  const nextHashes = [...storedHashes.slice(0, idx), ...storedHashes.slice(idx + 1)];
  return { valid: true, nextHashes };
}
