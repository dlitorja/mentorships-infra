import { Client, Configuration, Environment } from "@paypal/paypal-server-sdk";

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
 * Get or create PayPal client instance
 * 
 * @returns Configured PayPal client
 */
export function getPayPalClient(): Client {
  const clientId = getPayPalClientId();
  const clientSecret = getPayPalClientSecret();
  const isLive = process.env.PAYPAL_MODE === "live";

  const config: Partial<Configuration> = {
    environment: isLive ? Environment.Production : Environment.Sandbox,
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
    },
  };

  return new Client(config);
}

