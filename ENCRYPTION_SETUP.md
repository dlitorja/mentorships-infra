# Encryption Setup for Google Refresh Tokens

## Overview

Google refresh tokens are now encrypted before storage in the database using AES-256-GCM encryption. This ensures that sensitive authentication tokens are protected even if the database is compromised.

## Environment Variable Setup

You must set the `ENCRYPTION_KEY` environment variable before using encryption features:

```bash
# Generate a secure encryption key (32 bytes = 256 bits)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Add to your .env.local file
ENCRYPTION_KEY=<generated-key-here>
```

**Important:**
- The encryption key must be **exactly the same** across all application instances
- **Never commit** the encryption key to version control
- Store the key securely (e.g., Vercel environment variables, secrets manager)
- If you change the key, you'll need to re-encrypt all existing data

## Migration from Unencrypted Data

If you have existing unencrypted refresh tokens in the database:

1. **Backup your database** before running migration
2. The decryption function includes backward compatibility - it will return the original value if decryption fails
3. To migrate existing data, you can:
   - Wait for tokens to be updated naturally (when users reconnect Google Calendar)
   - Or run a migration script to re-encrypt existing tokens

## Implementation Details

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: scrypt (key stretching for security)
- **Salt**: Random 32-byte salt per encryption (unique per ciphertext)
- **IV (Initialization Vector)**: Unique per encryption (16 bytes)
- **Storage format**: Base64-encoded (version byte + salt + IV + encrypted data + auth tag)

## Format Versioning (February 2026)

The encryption format was updated to use random salts with an explicit version prefix:

| Version | Format | Detection |
|---------|--------|-----------|
| **v1 (Legacy)** | IV (16) + ciphertext + authTag (16) | First byte is NOT 0x02 |
| **v2 (Current)** | version (1: 0x02) + salt (32) + IV (16) + ciphertext + authTag (16) | First byte IS 0x02 |

**Backward Compatibility**: The `decrypt()` function checks the first byte to determine format version. If it's `0x02`, it's v2 format; otherwise, it's treated as v1 legacy format. This provides reliable format detection regardless of ciphertext length.

**Key Rotation Support**: Random salts enable future key rotation - each ciphertext has its own salt, so keys can be rotated on a per-record basis if needed.

## Code Usage

### Storing Encrypted Tokens

```typescript
import { updateMentorGoogleCalendarAuth } from "@mentorships/db";

// Token is automatically encrypted before storage
await updateMentorGoogleCalendarAuth(mentorId, {
  googleRefreshToken: refreshToken, // Plaintext token
  googleCalendarId: "primary",
});
```

### Retrieving Decrypted Tokens

```typescript
import { getMentorById, decryptMentorRefreshToken } from "@mentorships/db";

const mentor = await getMentorById(mentorId);
const refreshToken = decryptMentorRefreshToken(mentor); // Decrypted token

if (refreshToken) {
  // Use the decrypted token for API calls
  const calendar = await getGoogleCalendarClient(refreshToken);
}
```

## Security Notes

- Encryption happens at the application layer before database storage
- Decrypted tokens should **never** be returned to the client
- Decrypted tokens should **never** be logged
- The `decryptMentorRefreshToken` helper includes error handling for legacy unencrypted data

## Troubleshooting

**Error: "ENCRYPTION_KEY environment variable is required"**
- Set the `ENCRYPTION_KEY` environment variable in your `.env.local` file or deployment environment

**Error: "Decryption failed: Invalid encrypted data"**
- This can happen if:
  - The encryption key changed
  - The data was corrupted
  - The data is unencrypted (legacy data)
- The function will gracefully handle legacy unencrypted data by returning the original value

