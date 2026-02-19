import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * Encryption utility for sensitive data (e.g., Google refresh tokens)
 *
 * Uses AES-256-GCM encryption with a key derived from ENCRYPTION_KEY environment variable.
 *
 * Security notes:
 * - Uses authenticated encryption (GCM mode) to prevent tampering
 * - Each encryption uses a unique salt and IV (initialization vector)
 * - Salt enables key rotation without re-encrypting all data
 * - Version byte prefix ensures reliable format detection
 * - Key is derived using scrypt for key stretching
 *
 * Format v2 (current): version (1 byte: 0x02) + salt (32 bytes) + IV (16 bytes) + ciphertext + authTag (16 bytes)
 * Format v1 (legacy): IV (16 bytes) + ciphertext + authTag (16 bytes)
 *
 * Environment variable required:
 * - ENCRYPTION_KEY: A strong, random secret key (32+ bytes recommended)
 *   Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 32 bytes = 256 bits
const IV_LENGTH = 16; // 16 bytes for GCM IV
const SALT_LENGTH = 32; // 32 bytes for key derivation salt
const TAG_LENGTH = 16; // 16 bytes for GCM authentication tag
const VERSION_V2 = 0x02; // Version byte for new format with random salt

/**
 * Gets the encryption key from environment variable
 */
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

/**
 * Derives an encryption key using scrypt with a unique salt
 * Each encryption uses a random salt for better security and key rotation support
 */
function deriveKey(encryptionKey: string, salt: Buffer): Buffer {
  // Derive the key using scrypt (key stretching)
  return scryptSync(encryptionKey, salt, KEY_LENGTH);
}

/**
 * Encrypts a string value using AES-256-GCM
 * 
 * @param plaintext - The value to encrypt
 * @returns Encrypted value as base64 string (version + salt + IV + encrypted data + auth tag)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return plaintext; // Don't encrypt empty strings
  }

  try {
    const encryptionKey = getEncryptionKey();
    const salt = randomBytes(SALT_LENGTH);
    const key = deriveKey(encryptionKey, salt);
    const iv = randomBytes(IV_LENGTH);
    
    const cipher = createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Get the authentication tag (prevents tampering)
    const authTag = cipher.getAuthTag();
    
    // Combine version byte + salt + IV + encrypted data + auth tag
    const versionByte = Buffer.from([VERSION_V2]);
    const combined = Buffer.concat([versionByte, salt, iv, encrypted, authTag]);
    
    // Return as base64 for safe storage in database
    return combined.toString("base64");
  } catch (error) {
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Decrypts a base64-encoded encrypted value
 * Supports both v2 format (with version byte + salt) and v1 legacy format (without salt) for backward compatibility
 * 
 * @param encryptedBase64 - The encrypted value as base64 string
 * @returns Decrypted plaintext string
 */
export function decrypt(encryptedBase64: string): string {
  if (!encryptedBase64) {
    return encryptedBase64; // Don't decrypt empty strings
  }

  try {
    const encryptionKey = getEncryptionKey();
    const combined = Buffer.from(encryptedBase64, "base64");
    
    // Determine format by checking version byte
    // v2 format: first byte is 0x02
    // v1 legacy format: first byte is part of IV (random, but won't be 0x02 consistently)
    const firstByte = combined[0];
    const isNewFormat = firstByte === VERSION_V2;
    
    let salt: Buffer;
    let iv: Buffer;
    let encrypted: Buffer;
    let authTag: Buffer;
    
    if (isNewFormat) {
      // v2 format: version (1) + salt (32) + IV (16) + data + tag (16)
      salt = combined.subarray(1, 1 + SALT_LENGTH);
      iv = combined.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
      authTag = combined.subarray(combined.length - TAG_LENGTH);
      encrypted = combined.subarray(1 + SALT_LENGTH + IV_LENGTH, combined.length - TAG_LENGTH);
    } else {
      // v1 legacy format: IV (16) + data + tag (16)
      // Use hardcoded salt for backward compatibility
      salt = scryptSync(encryptionKey, "mentorships-encryption-salt", SALT_LENGTH);
      iv = combined.subarray(0, IV_LENGTH);
      authTag = combined.subarray(combined.length - TAG_LENGTH);
      encrypted = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);
    }
    
    const key = deriveKey(encryptionKey, salt);
    
    const decipher = createDecipheriv(ALGORITHM, key, iv);
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

/**
 * Checks if a value appears to be encrypted (base64 format check)
 * This is a heuristic - not foolproof, but useful for migration scenarios
 * 
 * Note: Supports both v2 format (version + salt + IV + data + tag) and v1 legacy format (IV + data + tag)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  
  // Encrypted values are base64, so they should only contain base64 characters
  // Minimum length check:
  // v2: version (1) + salt (32) + iv (16) + 1 byte data + tag (16) = 66 bytes = ~89 base64 chars
  // v1: iv (16) + 1 byte data + tag (16) = 33 bytes = ~44 base64 chars
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(value) && value.length >= 44;
}
