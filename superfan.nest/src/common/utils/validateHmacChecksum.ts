import * as crypto from 'crypto';

export function validateHmacChecksum(
  body: Buffer,
  checksum: string,
  secret: string,
): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);

  const expected = hmac.digest();
  const actual = Buffer.from(checksum, 'base64');

  return crypto.timingSafeEqual(actual, expected);
}