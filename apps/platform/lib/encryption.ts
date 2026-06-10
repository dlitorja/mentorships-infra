import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * Encryption utility for sensitive data (e.g., Google refresh tokens)
 *
 * Uses AES-256-GCM encryption with a key derived from ENCRYPTION_KEY environment variable.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const VERSION_V2 = 0x02;

function getEncryptionKey(): string {
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!encryptionKey) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required for encrypting sensitive data. " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  return encryptionKey;
}

function deriveKey(encryptionKey: string, salt: Buffer): Buffer {
  return scryptSync(encryptionKey, salt, KEY_LENGTH);
}

export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return plaintext;
  }

  try {
    const encryptionKey = getEncryptionKey();
    const salt = randomBytes(SALT_LENGTH);
    const key = deriveKey(encryptionKey, salt);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    const versionByte = Buffer.from([VERSION_V2]);
    const combined = Buffer.concat([versionByte, salt, iv, encrypted, authTag]);

    return combined.toString("base64");
  } catch (error) {
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function decrypt(encryptedBase64: string): string {
  if (!encryptedBase64) {
    return encryptedBase64;
  }

  try {
    const encryptionKey = getEncryptionKey();
    const combined = Buffer.from(encryptedBase64, "base64");

    const firstByte = combined[0];
    const isNewFormat = firstByte === VERSION_V2;

    let iv: Buffer;
    let encrypted: Buffer;
    let authTag: Buffer;
    let key: Buffer;

    if (isNewFormat) {
      const salt = combined.subarray(1, 1 + SALT_LENGTH);
      iv = combined.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
      authTag = combined.subarray(combined.length - TAG_LENGTH);
      encrypted = combined.subarray(1 + SALT_LENGTH + IV_LENGTH, combined.length - TAG_LENGTH);
      key = deriveKey(encryptionKey, salt);
    } else {
      iv = combined.subarray(0, IV_LENGTH);
      authTag = combined.subarray(combined.length - TAG_LENGTH);
      encrypted = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);
      key = scryptSync(encryptionKey, "mentorships-encryption-salt", KEY_LENGTH);
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString("utf8");
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unsupported state")) {
      throw new Error(
        "Decryption failed: Invalid encrypted data or wrong encryption key. " +
        "If migrating from unencrypted data, you may need to handle legacy values."
      );
    }
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function isEncrypted(value: string): boolean {
  if (!value) return false;

  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(value) && value.length >= 44;
}