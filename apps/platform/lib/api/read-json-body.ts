/**
 * Safely parse a JSON request body. Returns `null` for syntactically
 * invalid JSON so route handlers can return a 400 instead of bubbling
 * a 500 from `req.json()`. PR admin-onboarding #2 review feedback:
 * CodeRabbit wants both preview + onboard routes to share this helper.
 */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
