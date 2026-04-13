import { getPayPalClientId, getPayPalClientSecret } from "./client";

export type PayPalProductType = "PHYSICAL" | "DIGITAL" | "SERVICE";

export interface CreatePayPalProductInput {
  name: string;
  description?: string;
  type?: PayPalProductType;
  imageUrl?: string;
  homeUrl?: string;
}

export interface PayPalProductResult {
  id: string;
  name: string;
  description?: string;
  type: string;
  createTime: string;
  updateTime: string;
  links: Array<{
    href: string;
    rel: string;
    method: string;
  }>;
}

function getPayPalBaseUrl(): string {
  const mode = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
  return mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  
  if (cachedAccessToken && cachedAccessToken.expiresAt > now) {
    return cachedAccessToken.token;
  }

  const clientId = getPayPalClientId();
  const clientSecret = getPayPalClientSecret();
  const baseUrl = getPayPalBaseUrl();

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get PayPal access token: ${response.status} ${error}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in - 60) * 1000,
  };

  return data.access_token;
}

export async function createPayPalProduct(
  input: CreatePayPalProductInput
): Promise<PayPalProductResult> {
  const accessToken = await getAccessToken();
  const baseUrl = getPayPalBaseUrl();

  const productData = {
    name: input.name,
    description: input.description || `${input.name} - Mentorship Session Pack`,
    type: input.type || "SERVICE",
    ...(input.imageUrl && { image_url: input.imageUrl }),
    ...(input.homeUrl && { home_url: input.homeUrl }),
  };

  const response = await fetch(`${baseUrl}/v1/catalogs/products`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `product-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    },
    body: JSON.stringify(productData),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create PayPal product: ${response.status} ${error}`);
  }

  return response.json() as Promise<PayPalProductResult>;
}

export async function getPayPalProduct(productId: string): Promise<PayPalProductResult> {
  const accessToken = await getAccessToken();
  const baseUrl = getPayPalBaseUrl();

  const response = await fetch(`${baseUrl}/v1/catalogs/products/${productId}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get PayPal product: ${response.status} ${error}`);
  }

  return response.json() as Promise<PayPalProductResult>;
}

export async function updatePayPalProduct(
  productId: string,
  updates: Partial<CreatePayPalProductInput>
): Promise<void> {
  const accessToken = await getAccessToken();
  const baseUrl = getPayPalBaseUrl();

  const patchOperations = Object.entries(updates)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({
      op: "replace" as const,
      path: `/${key === "imageUrl" ? "image_url" : key}`,
      value: value,
    }));

  if (patchOperations.length === 0) {
    return;
  }

  const response = await fetch(`${baseUrl}/v1/catalogs/products/${productId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patchOperations),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update PayPal product: ${response.status} ${error}`);
  }
}

export function getPayPalProductDashboardLink(productId: string): string {
  const mode = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
  if (mode === "live") {
    return `https://www.paypal.com/myaccount/integrationproducts/${productId}`;
  }
  return `https://www.sandbox.paypal.com/myaccount/integrationproducts/${productId}`;
}
