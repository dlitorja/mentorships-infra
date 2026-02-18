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
 * - Salt + IV + auth tag are prepended to the encrypted data
 * - Key is derived using scrypt for key stretching
 *
 * Format: salt (32 bytes) + IV (16 bytes) + ciphertext + authTag (16 bytes)
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
 * @returns Encrypted value as base64 string (salt + IV + encrypted data + auth tag)
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
    
    // Combine salt + IV + encrypted data + auth tag
    const combined = Buffer.concat([salt, iv, encrypted, authTag]);
    
    // Return as base64 for safe storage in database
    return combined.toString("base64");
  } catch (error) {
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Decrypts a base64-encoded encrypted value
 * Supports both new format (with salt) and legacy format (without salt) for backward compatibility
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
    
    // Determine if this is new format (with salt) or legacy format
    // New format: salt (32) + iv (16) + data + tag (16) = minimum 64 bytes
    // Legacy format: iv (16) + data + tag (16) = minimum 32 bytes
    const isNewFormat = combined.length >= SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
    
    let salt: Buffer;
    let iv: Buffer;
    let encrypted: Buffer;
    let authTag: Buffer;
    
    if (isNewFormat) {
      // New format with salt
      salt = combined.subarray(0, SALT_LENGTH);
      iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      authTag = combined.subarray(combined.length - TAG_LENGTH);
      encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH, combined.length - TAG_LENGTH);
    } else {
      // Legacy format without salt - use hardcoded salt for backward compatibility
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
    // If decryption fails, it might be unencrypted data (for migration purposes)
    // Log but don't throw - let the caller handle it
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
 * Note: Supports both new format (salt + IV + data + tag) and legacy format (IV + data + tag)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  
  // Encrypted values are base64, so they should only contain base64 characters
  // Minimum length check: salt (32) + iv (16) + 1 byte data + tag (16) = 65 bytes = ~88 base64 chars
  // Or legacy: iv (16) + 1 byte data + tag (16) = 33 bytes = ~44 base64 chars
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(value) && value.length >= 44;
}
