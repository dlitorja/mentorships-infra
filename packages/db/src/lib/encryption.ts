import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * Encryption utility for sensitive data (e.g., Google refresh tokens)
 * 
 * Uses AES-256-GCM encryption with a key derived from ENCRYPTION_KEY environment variable.
 * 
 * Security notes:
 * - Uses authenticated encryption (GCM mode) to prevent tampering
 * - Each encryption uses a unique IV (initialization vector)
 * - The IV is prepended to the encrypted data
 * - Key is derived using scrypt for key stretching
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
 * Derives an encryption key from the ENCRYPTION_KEY environment variable
 * Uses scrypt for key stretching to resist brute-force attacks
 */
function deriveKey(): Buffer {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  
  if (!encryptionKey) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required for encrypting sensitive data. " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  // Use a fixed salt derived from the encryption key itself
  // This ensures consistent key derivation (same input = same output)
  // For production, consider using a separate SALT env var if you need key rotation
  const salt = scryptSync(encryptionKey, "mentorships-encryption-salt", SALT_LENGTH);
  
  // Derive the key using scrypt (key stretching)
  return scryptSync(encryptionKey, salt, KEY_LENGTH);
}

/**
 * Encrypts a string value using AES-256-GCM
 * 
 * @param plaintext - The value to encrypt
 * @returns Encrypted value as base64 string (IV + encrypted data + auth tag)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return plaintext; // Don't encrypt empty strings
  }

  try {
    const key = deriveKey();
    const iv = randomBytes(IV_LENGTH);
    
    const cipher = createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Get the authentication tag (prevents tampering)
    const authTag = cipher.getAuthTag();
    
    // Combine IV + encrypted data + auth tag
    const combined = Buffer.concat([iv, encrypted, authTag]);
    
    // Return as base64 for safe storage in database
    return combined.toString("base64");
  } catch (error) {
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Decrypts a base64-encoded encrypted value
 * 
 * @param encryptedBase64 - The encrypted value as base64 string
 * @returns Decrypted plaintext string
 */
export function decrypt(encryptedBase64: string): string {
  if (!encryptedBase64) {
    return encryptedBase64; // Don't decrypt empty strings
  }

  try {
    const key = deriveKey();
    const combined = Buffer.from(encryptedBase64, "base64");
    
    // Extract IV, encrypted data, and auth tag
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(combined.length - TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);
    
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
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  
  // Encrypted values are base64, so they should only contain base64 characters
  // and have a minimum length (IV + some data + tag = at least 48 bytes = 64 base64 chars)
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(value) && value.length >= 64;
}
