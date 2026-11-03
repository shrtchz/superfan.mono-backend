import * as crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_STEP_TOLERANCE = 1;
const SECRET_BYTE_LENGTH = 20;

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(SECRET_BYTE_LENGTH));
}

export function buildOtpauthUri(secret: string, label: string, issuer: string): string {
  const encodedLabel = encodeURIComponent(label);
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedSecret = encodeURIComponent(secret);
  return `otpauth://totp/${encodedIssuer}:${encodedLabel}?secret=${encodedSecret}&issuer=${encodedIssuer}`;
}

export function generateTotpToken(secret: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);
  return hotp(base32Decode(secret), counter, TOTP_DIGITS);
}

export function verifyTotpToken(secret: string, token: string): boolean {
  const tokenBuffer = Buffer.from(token, 'utf8');
  const currentCounter = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);

  for (let i = -TOTP_STEP_TOLERANCE; i <= TOTP_STEP_TOLERANCE; i++) {
    const expected = Buffer.from(
      hotp(base32Decode(secret), currentCounter + i, TOTP_DIGITS),
      'utf8',
    );
    if (safeEqual(expected, tokenBuffer)) {
      return true;
    }
  }
  return false;
}

function hotp(key: Buffer, counter: number, digits: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = input.replace(/[=\s]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 character in secret.');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}