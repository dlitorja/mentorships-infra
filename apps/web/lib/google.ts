import { google } from "googleapis";

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_URL) {
    return process.env.NEXT_PUBLIC_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set in production");
  }

  return "http://localhost:3000";
}

function requireGoogleEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not set");
  }
  if (!clientSecret) {
    throw new Error("GOOGLE_CLIENT_SECRET is not set");
  }

  return { clientId, clientSecret };
}

export function getGoogleRedirectUri(): string {
  return `${getBaseUrl()}/api/auth/google/callback`;
}

export function createGoogleOAuthClient() {
  const { clientId, clientSecret } = requireGoogleEnv();
  const redirectUri = getGoogleRedirectUri();

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getGoogleCalendarAuthUrl(state: string): string {
  const oauth2 = createGoogleOAuthClient();

  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // ensure refresh_token is returned
    include_granted_scopes: true,
    state,
    scope: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
  });
}

export async function exchangeGoogleCodeForTokens(code: string) {
  const oauth2 = createGoogleOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

export async function getGoogleCalendarClient(refreshToken: string) {
  const oauth2 = createGoogleOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });

  // The google client will refresh access tokens automatically as needed.
  return google.calendar({ version: "v3", auth: oauth2 });
}

