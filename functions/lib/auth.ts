/**
 * Validates an incoming key against one or more allowed keys stored in env.
 *
 * Env vars checked (first match wins):
 *   DEPLOY_AUTH_KEY   – primary key (single string)
 *   DEPLOY_AUTH_KEY_2 – second user's key
 *
 * Returns true if the provided key matches any authorized key.
 * Uses constant-time comparison to prevent timing attacks.
 */
/** Extract the auth key from X-Auth-Key header or Authorization: Bearer token. */
export function getAuthKey(request: Request): string | null {
  const xAuthKey = request.headers.get("X-Auth-Key");
  if (xAuthKey) return xAuthKey;
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
}

export function isAuthorized(providedKey: string | null, env: Record<string, string | undefined>): boolean {
  if (!providedKey) return false;

  const validKeys = [env.DEPLOY_AUTH_KEY, env.DEPLOY_AUTH_KEY_2].filter(Boolean) as string[];

  for (const key of validKeys) {
    if (constantTimeEqual(providedKey, key)) return true;
  }
  return false;
}

/** Constant-time string comparison to prevent timing side-channels. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate to avoid length-leaking timing, then return false
    let acc = 0;
    for (let i = 0; i < a.length; i++) acc |= a.charCodeAt(i);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
