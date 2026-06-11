export interface LogEntry {
  ts: string;
  endpoint: string;
  detail: string;
  ok: boolean;
}

export async function log(
  kv: KVNamespace,
  endpoint: string,
  detail: string,
  ok: boolean
): Promise<void> {
  try {
    const entry: LogEntry = { ts: new Date().toISOString(), endpoint, detail, ok };
    const key = `log:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
    await kv.put(key, JSON.stringify(entry), { expirationTtl: 86400 }); // 24h TTL
  } catch {
    // never let logging break the request
  }
}

export async function getLogs(kv: KVNamespace, limit = 30): Promise<LogEntry[]> {
  const list = await kv.list({ prefix: "log:", limit: 1000 });
  const keys = list.keys
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, limit);
  const entries = await Promise.all(
    keys.map(async (k) => {
      const v = await kv.get(k.name);
      return v ? (JSON.parse(v) as LogEntry) : null;
    })
  );
  return entries.filter(Boolean) as LogEntry[];
}
