import { Client, Configuration, Environment } from "@paypal/paypal-server-sdk";

let cachedClient: Client | null = null;

/**
 * Get PayPal client ID from environment
 * 
 * @returns PayPal client ID
 * @throws Error if PAYPAL_CLIENT_ID is not set
 */
export function getPayPalClientId(): string {
  const clientId = process.env.PAYPAL_CLIENT_ID;

  if (!clientId) {
    throw new Error(
      "PAYPAL_CLIENT_ID environment variable is required. " +
      "Please set it in your .env.local file."
    );
  }

  return clientId;
}

/**
 * Get PayPal client secret from environment
 * 
 * @returns PayPal client secret
 * @throws Error if PAYPAL_CLIENT_SECRET is not set
 */
export function getPayPalClientSecret(): string {
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientSecret) {
    throw new Error(
      "PAYPAL_CLIENT_SECRET environment variable is required. " +
      "Please set it in your .env.local file."
    );
  }

  return clientSecret;
}

/**
 * Get or create PayPal client instance (cached)
 * 
 * @returns Configured PayPal client
 */
export function getPayPalClient(): Client {
  if (cachedClient) {
    return cachedClient;
  }

  const clientId = getPayPalClientId();
  const clientSecret = getPayPalClientSecret();
  
  // Validate PAYPAL_MODE
  const mode = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
  if (mode !== "sandbox" && mode !== "live") {
    throw new Error(
      `Invalid PAYPAL_MODE: ${process.env.PAYPAL_MODE}. Must be "sandbox" or "live"`
    );
  }
  const isLive = mode === "live";

  const config: Partial<Configuration> = {
    environment: isLive ? Environment.Production : Environment.Sandbox,
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
    },
  };

  cachedClient = new Client(config);
  return cachedClient;
}

