export interface DeployResult {
  url: string;
  appName: string;
}

/** Sanitise a project name to a safe URL path segment. */
export function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 63);
}

/**
 * Store HTML in KV.  Key = "app:{name}", value = raw HTML string.
 * Returns the public URL where the app will be served.
 */
export async function deployToKV(
  rawName: string,
  htmlContent: string,
  kv: KVNamespace,
  baseUrl: string
): Promise<DeployResult> {
  const appName = sanitizeName(rawName);
  if (!appName) throw new Error("projectName is invalid after sanitising");

  await kv.put(`app:${appName}`, htmlContent, {
    metadata: { deployedAt: new Date().toISOString() },
  });

  return {
    appName,
    url: `${baseUrl}/apps/${appName}`,
  };
}
