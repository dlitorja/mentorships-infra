export async function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    const expectedSignature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );
    
    const expectedBytes = new Uint8Array(expectedSignature);
    const signatureBytes = encoder.encode(signature);
    
    if (signatureBytes.length !== expectedBytes.length) {
      return false;
    }
    
    for (let i = 0; i < expectedBytes.length; i++) {
      if (expectedBytes[i] !== signatureBytes[i]) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}
