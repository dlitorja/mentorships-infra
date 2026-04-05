const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;

export async function verifyTurnstileToken(
  token: string,
  ip?: string
): Promise<boolean> {
  if (!token || !TURNSTILE_SECRET_KEY) {
    return false;
  }

  const formData = new FormData();
  formData.append("secret", TURNSTILE_SECRET_KEY);
  formData.append("response", token);

  if (ip) {
    formData.append("remoteip", ip);
  }

  try {
    const result = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
      }
    );

    const data = await result.json();
    return data.success === true;
  } catch {
    return false;
  }
}

export function getClientIp(req: Request): string | undefined {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0] ||
    req.headers.get("x-real-ip") ||
    undefined
  );
}
