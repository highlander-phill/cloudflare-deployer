const BASE = "https://api.cloudflare.com/client/v4";

export async function cfFetch(
  path: string,
  method: string,
  token: string,
  body?: object
): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as any;
  if (!json.success) {
    const msg = json.errors?.[0]?.message ?? JSON.stringify(json.errors);
    throw new Error(`CF API ${method} ${path} → ${msg}`);
  }
  return json.result;
}

export async function cfFetchRaw(
  path: string,
  method: string,
  token: string,
  body: FormData | string,
  contentType?: string
): Promise<any> {
  const headers: Record<string, string> = { "Authorization": `Bearer ${token}` };
  if (contentType) headers["Content-Type"] = contentType;
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const json = await res.json() as any;
  if (!json.success) {
    const msg = json.errors?.[0]?.message ?? JSON.stringify(json.errors);
    throw new Error(`CF API ${method} ${path} → ${msg}`);
  }
  return json.result;
}
