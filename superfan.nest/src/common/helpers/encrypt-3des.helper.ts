import forge from 'node-forge';

export function encrypt3DES(encryptionKey: string, payload: any): string {
  const text = JSON.stringify(payload);

  const cipher = forge.cipher.createCipher(
    '3DES-ECB',
    forge.util.createBuffer(encryptionKey)
  );

  cipher.start({ iv: '' });
  cipher.update(forge.util.createBuffer(text, 'utf8'));
  cipher.finish();

  return forge.util.encode64(cipher.output.getBytes());
}