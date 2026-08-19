declare const atob: (input: string) => string;

/**
 * Decode a base64url-encoded string into a UTF-8 string.
 */
function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Decode the `exp` claim from a JWT without verifying the signature. Used only
 * to bound the KV cache TTL to the token's lifetime so a cached entry cannot
 * outlive the credential that authorized it.
 */
export function getJwtExpirationSeconds(token: string): number | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;

    const payload = JSON.parse(base64UrlDecode(parts[1] ?? "")) as {
      exp?: number;
    };

    return payload.exp;
  } catch {
    return undefined;
  }
}
