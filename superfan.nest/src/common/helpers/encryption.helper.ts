import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// const SECRET = process.env.KEY_ENCRYPTION_SECRET!; // must be 32 bytes

// Derive a 32-byte key from your secret
function getKey(): Buffer {
    const SECRET = process.env.KEY_ENCRYPTION_SECRET;
      if (!SECRET) {
    throw new Error(
      'KEY_ENCRYPTION_SECRET environment variable is not set. ' +
      'Ensure it is defined in your .env file and loaded before this module is used.'
    );
  }
  return crypto.createHash('sha256').update(SECRET).digest();
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12); // GCM recommended 12 bytes
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Store iv + authTag + encrypted
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(payload: string): string {
  const data = Buffer.from(payload, 'base64');

  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}