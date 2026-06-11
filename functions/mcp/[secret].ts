import { deployToKV } from "../lib/kv-deploy";
import { log, getLogs } from "../lib/logger";
import { cfFetch, cfFetchRaw } from "../lib/cf-api";

interface Env {
  APPS: KVNamespace;
  AI: any;
  DEPLOY_AUTH_KEY: string;
  DEPLOY_AUTH_KEY_2?: string;
  OAUTH_CLIENT_1_ID?: string;
  OAUTH_CLIENT_2_ID?: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  MCP_SECRET: string;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "ping",
    description: "Check the MCP server is alive. No auth required.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "deploy_app",
    description: "Deploy a complete web app (HTML/CSS/JS) to a live public URL instantly. Optionally provision a D1 database, KV store, R2 bucket, and JWT auth in one call.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "URL-safe name (letters, numbers, hyphens, max 63 chars)" },
        htmlContent: { type: "string", description: "Full <!DOCTYPE html> document with all CSS/JS inlined" },
        withD1: { type: "boolean", description: "Provision a D1 database with pokemon-collection schema" },
        withKV: { type: "boolean", description: "Provision a KV namespace for sessions/caching" },
        withR2: { type: "boolean", description: "Provision an R2 bucket for file/image storage" },
        withAuth: { type: "boolean", description: "Deploy a JWT auth Worker (signup/login/validate/logout)" },
      },
      required: ["projectName", "htmlContent"],
    },
  },
  {
    name: "chat_with_ai",
    description: "Chat with an LLM via Workers AI. Optionally pass context (e.g. a card collection) for grounded answers.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        context: { type: "string", description: "Optional background context for the AI" },
        model: { type: "string", description: "Workers AI model ID (default: @cf/meta/llama-3.1-8b-instruct)" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "analyze_card",
    description: "Analyze a Pokemon (or any trading) card image with vision AI. Returns pokemon name, rarity, condition, and estimated value.",
    inputSchema: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "Public URL of the card image" },
      },
      required: ["imageUrl"],
    },
  },
  {
    name: "create_d1_schema",
    description: "Create a Cloudflare D1 (SQLite) database and apply a schema. Use schemaType='pokemon-collection' for a ready-made cards/users/collections schema.",
    inputSchema: {
      type: "object",
      properties: {
        appName: { type: "string" },
        schemaType: { type: "string", enum: ["pokemon-collection", "custom"] },
        customSchema: { type: "string", description: "SQL DDL string (required when schemaType is 'custom')" },
      },
      required: ["appName", "schemaType"],
    },
  },
  {
    name: "query_d1",
    description: "Execute a SQL query against a D1 database previously created with create_d1_schema.",
    inputSchema: {
      type: "object",
      properties: {
        appName: { type: "string", description: "Same appName used in create_d1_schema" },
        sql: { type: "string" },
        params: { type: "array", description: "Positional parameters for ? placeholders", items: {} },
      },
      required: ["appName", "sql"],
    },
  },
  {
    name: "create_kv_namespace",
    description: "Create a Cloudflare Workers KV namespace for an app (sessions, cache, config).",
    inputSchema: {
      type: "object",
      properties: { appName: { type: "string" } },
      required: ["appName"],
    },
  },
  {
    name: "create_r2_bucket",
    description: "Create a Cloudflare R2 bucket for an app (file and image storage). Requires R2 to be enabled in the Cloudflare Dashboard.",
    inputSchema: {
      type: "object",
      properties: { appName: { type: "string" } },
      required: ["appName"],
    },
  },
  {
    name: "generate_signed_url",
    description: "Generate a time-limited signed URL to securely serve a file from an R2 bucket.",
    inputSchema: {
      type: "object",
      properties: {
        bucketName: { type: "string" },
        objectKey: { type: "string" },
        expiresInHours: { type: "number", description: "How many hours the URL should remain valid (default 1)" },
      },
      required: ["bucketName", "objectKey"],
    },
  },
  {
    name: "setup_authentication",
    description: "Deploy a JWT authentication Worker with signup, login, validate, and logout endpoints backed by a D1 database. Call create_d1_schema first.",
    inputSchema: {
      type: "object",
      properties: {
        appName: { type: "string", description: "Must match appName used in create_d1_schema" },
      },
      required: ["appName"],
    },
  },
  {
    name: "set_environment_secrets",
    description: "Store secrets (API keys, passwords, JWT secrets) as Worker environment variables.",
    inputSchema: {
      type: "object",
      properties: {
        workerName: { type: "string" },
        secrets: { type: "object", description: "Key-value pairs of secret name → secret value" },
      },
      required: ["workerName", "secrets"],
    },
  },
  {
    name: "setup_cors",
    description: "Generate CORS header configuration for a deployed app.",
    inputSchema: {
      type: "object",
      properties: {
        appName: { type: "string" },
        allowedDomains: { type: "array", items: { type: "string" }, description: "List of allowed origins" },
      },
      required: ["appName", "allowedDomains"],
    },
  },
  {
    name: "get_logs",
    description: "Retrieve recent server-side logs to diagnose connection or deployment issues.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of entries (default 30, max 50)" },
      },
    },
  },
  {
    name: "list_mcp_capabilities",
    description: "List all available MCP tools with their parameters and return values.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── Pokemon-collection D1 schema ──────────────────────────────────────────────

const POKEMON_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pokemon_name TEXT NOT NULL,
  image_url TEXT,
  condition TEXT,
  rarity TEXT,
  estimated_value REAL DEFAULT 0,
  notes TEXT,
  added_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_public INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS collection_cards (
  collection_id INTEGER NOT NULL,
  card_id INTEGER NOT NULL,
  PRIMARY KEY (collection_id, card_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);
`.trim();

// ── Auth Worker template ──────────────────────────────────────────────────────

function authWorkerScript(jwtSecret: string, dbId: string, kvId: string): string {
  return `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const json = (d, s = 200) => Response.json(d, { status: s, headers: cors });

    try {
      if (url.pathname === '/signup' && request.method === 'POST') {
        const { email, password } = await request.json();
        if (!email || !password) return json({ error: 'email and password required' }, 400);
        const hash = await hashPassword(password);
        try {
          await env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').bind(email, hash).run();
        } catch (e) {
          if (String(e).includes('UNIQUE')) return json({ error: 'email already registered' }, 409);
          throw e;
        }
        const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first();
        const token = await createJWT({ sub: user.id, email: user.email }, env.JWT_SECRET);
        return json({ token, user: { id: user.id, email: user.email } });
      }

      if (url.pathname === '/login' && request.method === 'POST') {
        const { email, password } = await request.json();
        const user = await env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').bind(email).first();
        if (!user || !await verifyPassword(password, user.password_hash)) return json({ error: 'invalid credentials' }, 401);
        const token = await createJWT({ sub: user.id, email: user.email }, env.JWT_SECRET);
        return json({ token, user: { id: user.id, email: user.email } });
      }

      if (url.pathname === '/validate' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token) return json({ error: 'no token provided' }, 401);
        const blocked = await env.SESSIONS.get('blocked:' + token);
        if (blocked) return json({ valid: false, error: 'token revoked' }, 401);
        const payload = await verifyJWT(token, env.JWT_SECRET);
        if (!payload) return json({ valid: false, error: 'invalid or expired token' }, 401);
        return json({ valid: true, userId: payload.sub, email: payload.email });
      }

      if (url.pathname === '/logout' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (token) await env.SESSIONS.put('blocked:' + token, '1', { expirationTtl: 604800 });
        return json({ success: true });
      }

      return json({
        endpoints: { signup: '/signup', login: '/login', validate: '/validate', logout: '/logout' },
        status: 'auth worker running'
      });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }
};

async function createJWT(payload, secret) {
  const enc = s => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/=/g,'').replace(/\\+/g,'-').replace(/\\//g,'_');
  const header = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ ...payload, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 2592000 });
  const data = header + '.' + body;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return data + '.' + btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\\+/g,'-').replace(/\\//g,'_');
}

async function verifyJWT(token, secret) {
  try {
    const [h, b, s] = token.split('.');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    if (!await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(h + '.' + b))) return null;
    const p = JSON.parse(atob(b.replace(/-/g,'+').replace(/_/g,'/')));
    return p.exp > Math.floor(Date.now()/1000) ? p : null;
  } catch { return null; }
}

async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const hex = a => [...new Uint8Array(a)].map(b => b.toString(16).padStart(2,'0')).join('');
  return hex(salt.buffer) + ':' + hex(bits);
}

async function verifyPassword(pw, stored) {
  const [saltHex, storedHash] = stored.split(':');
  const salt = Uint8Array.from(saltHex.match(/.{2}/g), b => parseInt(b, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,'0')).join('') === storedHash;
}
`.trim();
}

// ── CORS handler ─────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, X-Auth-Key, Authorization",
};

function rpcOk(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: CORS });
}
function rpcErr(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: CORS });
}
function toolOk(text: string) {
  return { content: [{ type: "text", text }] };
}
function toolErr(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleTool(name: string, args: any, env: Env, origin: string): Promise<object> {
  const acct = `/accounts/${env.CF_ACCOUNT_ID}`;

  // ── ping ──────────────────────────────────────────────────────────────────
  if (name === "ping") {
    return toolOk(`Server alive at ${new Date().toISOString()}\nSecrets: CF_API_TOKEN=${!!env.CF_API_TOKEN} AI=${!!env.AI}`);
  }

  // ── list_mcp_capabilities ────────────────────────────────────────────────
  if (name === "list_mcp_capabilities") {
    const summary = TOOLS.map(t => `• ${t.name} — ${t.description}`).join("\n");
    return toolOk(`Available tools (${TOOLS.length}):\n\n${summary}`);
  }

  // ── get_logs ─────────────────────────────────────────────────────────────
  if (name === "get_logs") {
    const entries = await getLogs(env.APPS, Math.min(args?.limit ?? 30, 50));
    const text = entries.length === 0 ? "No logs yet." :
      entries.map(e => `${e.ts} [${e.ok ? "OK" : "ERR"}] ${e.endpoint}: ${e.detail}`).join("\n");
    return toolOk(text);
  }

  // ── setup_cors ───────────────────────────────────────────────────────────
  if (name === "setup_cors") {
    const domains: string[] = args.allowedDomains ?? ["*"];
    const headers = {
      "Access-Control-Allow-Origin": domains.length === 1 ? domains[0] : domains.join(", "),
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };
    return toolOk(`CORS headers for ${args.appName}:\n${JSON.stringify(headers, null, 2)}\n\nAdd these to your Worker's fetch handler for ${domains.join(", ")}.`);
  }

  // ── chat_with_ai ─────────────────────────────────────────────────────────
  if (name === "chat_with_ai") {
    const model = args.model ?? "@cf/meta/llama-3.1-8b-instruct";
    const messages: any[] = [];
    if (args.context) messages.push({ role: "system", content: `Context:\n${args.context}` });
    messages.push({ role: "user", content: args.prompt });
    const result = await env.AI.run(model, { messages, max_tokens: 1024 });
    return toolOk(result.response ?? JSON.stringify(result));
  }

  // ── analyze_card ─────────────────────────────────────────────────────────
  if (name === "analyze_card") {
    const imgRes = await fetch(args.imageUrl);
    if (!imgRes.ok) throw new Error(`Could not fetch image: ${imgRes.status}`);
    const buf = await imgRes.arrayBuffer();
    const imageArr = [...new Uint8Array(buf)];
    const prompt = `Analyze this Pokemon trading card image carefully. Provide a JSON response with these exact fields:
{
  "pokemon": "name of the Pokemon on the card",
  "set": "card set name if visible",
  "rarity": "Common/Uncommon/Rare/Holo Rare/Ultra Rare/Secret Rare",
  "condition": "Mint/Near Mint/Excellent/Good/Poor/Damaged",
  "estimatedValue": <number in USD>,
  "details": "brief description of card features, foiling, artwork notes"
}
Reply with only the JSON, no extra text.`;
    const result = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", { image: imageArr, prompt, max_tokens: 512 });
    const raw = result.description ?? result.response ?? JSON.stringify(result);
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return toolOk(JSON.stringify(parsed, null, 2));
      }
    } catch {}
    return toolOk(raw);
  }

  // ── create_kv_namespace ──────────────────────────────────────────────────
  if (name === "create_kv_namespace") {
    const existing = await env.APPS.get(`kv:${args.appName}`);
    if (existing) {
      const data = JSON.parse(existing);
      return toolOk(`KV namespace already exists for ${args.appName}.\nNamespace ID: ${data.id}\nTitle: ${data.title}`);
    }
    const result = await cfFetch(`${acct}/storage/kv/namespaces`, "POST", env.CF_API_TOKEN,
      { title: `${args.appName}-kv` });
    await env.APPS.put(`kv:${args.appName}`, JSON.stringify({ id: result.id, title: result.title }));
    return toolOk(`KV namespace created for ${args.appName}.\nNamespace ID: ${result.id}\nTitle: ${result.title}`);
  }

  // ── create_r2_bucket ─────────────────────────────────────────────────────
  if (name === "create_r2_bucket") {
    const existing = await env.APPS.get(`r2:${args.appName}`);
    if (existing) {
      const data = JSON.parse(existing);
      return toolOk(`R2 bucket already exists for ${args.appName}.\nBucket: ${data.name}`);
    }
    const bucketName = `${args.appName}-storage`;
    await cfFetch(`${acct}/r2/buckets`, "POST", env.CF_API_TOKEN, { name: bucketName });
    await env.APPS.put(`r2:${args.appName}`, JSON.stringify({ name: bucketName }));
    return toolOk(`R2 bucket created for ${args.appName}.\nBucket name: ${bucketName}\nAccess via S3-compatible API: https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucketName}`);
  }

  // ── generate_signed_url ──────────────────────────────────────────────────
  if (name === "generate_signed_url") {
    const expiresAt = Math.floor(Date.now() / 1000) + (args.expiresInHours ?? 1) * 3600;
    const message = `${args.bucketName}/${args.objectKey}/${expiresAt}`;
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(env.DEPLOY_AUTH_KEY),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    const sigHex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
    const url = `${origin}/r2-proxy/${args.bucketName}/${encodeURIComponent(args.objectKey)}?exp=${expiresAt}&sig=${sigHex}`;
    return toolOk(`Signed URL (expires in ${args.expiresInHours ?? 1}h):\n${url}`);
  }

  // ── create_d1_schema ─────────────────────────────────────────────────────
  if (name === "create_d1_schema") {
    const existing = await env.APPS.get(`d1:${args.appName}`);
    if (existing) {
      const data = JSON.parse(existing);
      return toolOk(`D1 database already exists for ${args.appName}.\nDatabase ID: ${data.id}\nName: ${data.name}`);
    }
    const dbName = `${args.appName}-db`;
    const db = await cfFetch(`${acct}/d1/database`, "POST", env.CF_API_TOKEN, { name: dbName });
    const schema = args.schemaType === "pokemon-collection" ? POKEMON_SCHEMA : args.customSchema;
    if (!schema) throw new Error("customSchema is required when schemaType is 'custom'");

    // Run each statement individually (D1 API processes one statement per call)
    const statements = schema.split(";").map((s: string) => s.trim()).filter(Boolean);
    const failed: string[] = [];
    for (const sql of statements) {
      try {
        await cfFetch(`${acct}/d1/database/${db.uuid}/query`, "POST", env.CF_API_TOKEN, { sql: sql + ";" });
      } catch (e) {
        failed.push(`${sql.slice(0, 60)}… → ${String(e)}`);
      }
    }

    await env.APPS.put(`d1:${args.appName}`, JSON.stringify({ id: db.uuid, name: dbName }));
    const tables = statements
      .filter((s: string) => s.toUpperCase().includes("CREATE TABLE"))
      .map((s: string) => s.match(/TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i)?.[1] ?? "?");

    let text = `D1 database created for ${args.appName}.\nDatabase ID: ${db.uuid}\nName: ${dbName}\nTables: ${tables.join(", ")}`;
    if (failed.length) text += `\n\nWarnings:\n${failed.join("\n")}`;
    return toolOk(text);
  }

  // ── query_d1 ─────────────────────────────────────────────────────────────
  if (name === "query_d1") {
    const stored = await env.APPS.get(`d1:${args.appName}`);
    if (!stored) throw new Error(`No D1 database found for "${args.appName}". Run create_d1_schema first.`);
    const { id: dbId } = JSON.parse(stored);
    const result = await cfFetch(`${acct}/d1/database/${dbId}/query`, "POST", env.CF_API_TOKEN, {
      sql: args.sql,
      params: args.params ?? [],
    });
    const rows = Array.isArray(result) ? result[0]?.results ?? [] : result?.results ?? [];
    return toolOk(`${rows.length} row(s):\n${JSON.stringify(rows, null, 2)}`);
  }

  // ── set_environment_secrets ───────────────────────────────────────────────
  if (name === "set_environment_secrets") {
    const secrets = args.secrets as Record<string, string>;
    const results: string[] = [];
    for (const [secretName, secretValue] of Object.entries(secrets)) {
      await cfFetch(
        `${acct}/workers/scripts/${args.workerName}/secrets`, "PUT", env.CF_API_TOKEN,
        { name: secretName, text: secretValue, type: "secret_text" }
      );
      results.push(`✓ ${secretName}`);
    }
    return toolOk(`Secrets set on Worker "${args.workerName}":\n${results.join("\n")}`);
  }

  // ── setup_authentication ─────────────────────────────────────────────────
  if (name === "setup_authentication") {
    const d1Data = await env.APPS.get(`d1:${args.appName}`);
    if (!d1Data) throw new Error(`No D1 database found for "${args.appName}". Run create_d1_schema first.`);
    const { id: dbId } = JSON.parse(d1Data);

    // Create or reuse a KV namespace for token blocklist
    let kvId: string;
    const kvStored = await env.APPS.get(`kv:${args.appName}`);
    if (kvStored) {
      kvId = JSON.parse(kvStored).id;
    } else {
      const kvResult = await cfFetch(`${acct}/storage/kv/namespaces`, "POST", env.CF_API_TOKEN,
        { title: `${args.appName}-sessions` });
      kvId = kvResult.id;
      await env.APPS.put(`kv:${args.appName}`, JSON.stringify({ id: kvId, title: `${args.appName}-sessions` }));
    }

    // Generate JWT secret
    const jwtSecretBytes = new Uint8Array(32);
    crypto.getRandomValues(jwtSecretBytes);
    const jwtSecret = [...jwtSecretBytes].map(b => b.toString(16).padStart(2, "0")).join("");

    const workerName = `${args.appName}-auth`;
    const script = authWorkerScript(jwtSecret, dbId, kvId);

    const metadata = {
      main_module: "worker.js",
      compatibility_date: "2025-06-01",
      bindings: [
        { type: "d1", name: "DB", id: dbId },
        { type: "kv_namespace", name: "SESSIONS", namespace_id: kvId },
        { type: "secret_text", name: "JWT_SECRET", text: jwtSecret },
      ],
    };

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata");
    form.append("worker.js", new Blob([script], { type: "application/javascript+module" }), "worker.js");

    await cfFetchRaw(`${acct}/workers/scripts/${workerName}`, "PUT", env.CF_API_TOKEN, form);

    // Enable workers.dev subdomain
    await cfFetch(`${acct}/workers/scripts/${workerName}/subdomain`, "POST", env.CF_API_TOKEN, { enabled: true });

    const subRes = await cfFetch(`/accounts/${env.CF_ACCOUNT_ID}/workers/subdomain`, "GET", env.CF_API_TOKEN);
    const workerSubdomain = subRes.result?.subdomain;
    if (!workerSubdomain) throw new Error("Could not determine workers.dev subdomain from CF API");
    const base = `https://${workerName}.${workerSubdomain}.workers.dev`;
    await env.APPS.put(`auth:${args.appName}`, JSON.stringify({
      workerName, base, jwtSecret,
      endpoints: { signup: `${base}/signup`, login: `${base}/login`, validate: `${base}/validate`, logout: `${base}/logout` }
    }));

    return toolOk(
      `Auth Worker deployed for ${args.appName}.\n\n` +
      `Base URL: ${base}\n` +
      `POST ${base}/signup  — { email, password } → { token, user }\n` +
      `POST ${base}/login   — { email, password } → { token, user }\n` +
      `POST ${base}/validate — Authorization: Bearer <token> → { valid, userId, email }\n` +
      `POST ${base}/logout  — Authorization: Bearer <token> → { success }\n\n` +
      `JWT Secret stored securely in Worker environment.`
    );
  }

  // ── deploy_app (enhanced) ─────────────────────────────────────────────────
  if (name === "deploy_app") {
    const steps: string[] = [];
    let dbInfo: any = null;
    let kvInfo: any = null;
    let r2Info: any = null;
    let authInfo: any = null;

    if (args.withD1) {
      const r = await handleTool("create_d1_schema", { appName: args.projectName, schemaType: "pokemon-collection" }, env, origin);
      const text = (r as any).content[0].text;
      steps.push(`D1: ${text.split("\n")[0]}`);
      const stored = await env.APPS.get(`d1:${args.projectName}`);
      if (stored) dbInfo = JSON.parse(stored);
    }
    if (args.withKV) {
      const r = await handleTool("create_kv_namespace", { appName: args.projectName }, env, origin);
      steps.push((r as any).content[0].text.split("\n")[0]);
      const stored = await env.APPS.get(`kv:${args.projectName}`);
      if (stored) kvInfo = JSON.parse(stored);
    }
    if (args.withR2) {
      const r = await handleTool("create_r2_bucket", { appName: args.projectName }, env, origin);
      steps.push((r as any).content[0].text.split("\n")[0]);
      const stored = await env.APPS.get(`r2:${args.projectName}`);
      if (stored) r2Info = JSON.parse(stored);
    }
    if (args.withAuth) {
      const r = await handleTool("setup_authentication", { appName: args.projectName }, env, origin);
      steps.push((r as any).content[0].text.split("\n")[0]);
      const stored = await env.APPS.get(`auth:${args.projectName}`);
      if (stored) authInfo = JSON.parse(stored);
    }

    const deployResult = await deployToKV(args.projectName, args.htmlContent, env.APPS, origin);
    steps.push(`App deployed → ${deployResult.url}`);

    const summary = [
      `Deployed successfully!\n`,
      `Live URL: ${deployResult.url}`,
      ...(dbInfo ? [`D1 Database ID: ${dbInfo.id}`] : []),
      ...(kvInfo ? [`KV Namespace ID: ${kvInfo.id}`] : []),
      ...(r2Info ? [`R2 Bucket: ${r2Info.name}`] : []),
      ...(authInfo ? [
        `Auth endpoints:`,
        `  POST ${authInfo.endpoints.signup}`,
        `  POST ${authInfo.endpoints.login}`,
        `  POST ${authInfo.endpoints.validate}`,
        `  POST ${authInfo.endpoints.logout}`,
      ] : []),
      ...(steps.length > 1 ? [`\nProvisioning steps:\n${steps.map(s => `• ${s}`).join("\n")}`] : []),
    ].join("\n");

    return toolOk(summary);
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ── Request handler ───────────────────────────────────────────────────────────

function checkSecret(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const onRequestOptions: PagesFunction<Env> = async ({ params, env }) => {
  if (!checkSecret(params.secret as string, env.MCP_SECRET))
    return new Response("Unauthorized", { status: 401 });
  return new Response(null, { status: 204, headers: CORS });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params: routeParams }) => {
  if (!checkSecret(decodeURIComponent(routeParams.secret as string), env.MCP_SECRET))
    return new Response("Unauthorized", { status: 401 });
  let body: { jsonrpc: string; method: string; params?: any; id?: unknown };
  try {
    body = await request.json();
  } catch {
    return rpcErr(null, -32700, "Parse error");
  }
  const { method, params, id } = body;

  if (method === "initialize") {
    await log(env.APPS, "mcp", "initialize", true);
    return rpcOk(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "Cloudflare App Deployer", version: "3.0.0" },
    });
  }
  if (method === "notifications/initialized") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (method === "tools/list") {
    await log(env.APPS, "mcp", "tools/list", true);
    return rpcOk(id, { tools: TOOLS });
  }
  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments ?? {};
    const origin = new URL(request.url).origin;
    try {
      const result = await handleTool(toolName, args, env, origin);
      await log(env.APPS, "mcp", `${toolName} — ok`, true);
      return rpcOk(id, result);
    } catch (err) {
      await log(env.APPS, "mcp", `${toolName} — error: ${String(err)}`, false);
      return rpcOk(id, toolErr(`Error in ${toolName}: ${String(err)}`));
    }
  }

  return rpcErr(id, -32601, `Method not found: ${method}`);
};
