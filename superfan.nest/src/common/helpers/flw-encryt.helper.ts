const forge = require("node-forge");

// function getEncryptionKey(secretKey) {
//   // MD5 hash of secret key
//   const md5 = forge.md.md5.create();
//   md5.update(secretKey);
//   const hash = md5.digest().toHex(); // 32 hex chars

//   // Flutterwave uses first 24 chars as key
//   return hash.substring(0, 24);
// }

export function encryptData(secretKey, payload) {
//   const key = getEncryptionKey(secretKey);

  const text = JSON.stringify(payload);

  const cipher = forge.cipher.createCipher(
    "3DES-ECB",
    forge.util.createBuffer(secretKey)
  );

  cipher.start(); // ECB mode, no IV
  cipher.update(forge.util.createBuffer(text, "utf8"));
  cipher.finish();

  return forge.util.encode64(cipher.output.getBytes());
}