# Cloudflare Deployer MCP

A zero-CLI Cloudflare deployment platform. Claude.ai users (including non-technical ones) can publish full-stack web apps by chatting — no terminal, no account setup, no configuration.

Built on Cloudflare Pages Functions, Workers KV, Workers AI, D1, R2, and the Cloudflare REST API. The MCP server is itself a static Pages site with no build step.

---

## What you can do via Claude

- **Deploy apps instantly** — Claude builds an HTML/CSS/JS app and calls `deploy_app`. The user gets a live URL within seconds.
- **Add a database** — `create_d1_schema` provisions a SQLite D1 database with a chosen schema (e.g. Pokemon cards). `query_d1` runs SQL against it.
- **Add authentication** — `setup_authentication` deploys a full JWT auth Worker (signup / login / validate / logout) with PBKDF2 password hashing and HMAC-SHA256 JWTs.
- **Store files** — `create_r2_bucket` provisions R2 storage. `generate_signed_url` produces time-limited download links.
- **KV storage** — `create_kv_namespace` for lightweight key-value needs.
- **AI tools** — `chat_with_ai` (LLM) and `analyze_card` (vision) via Workers AI.
- **Secrets** — `set_environment_secrets` pushes environment variables into deployed Workers.
- **CORS** — `setup_cors` generates correct headers for cross-origin calls.
- **Diagnostics** — `get_logs` and `ping` let Claude self-diagnose connection problems.

---

## Architecture

```
Claude.ai ──MCP/HTTP──▶ Pages Function: /mcp/[secret]
                                │
                    ┌───────────┼───────────────────┐
                    ▼           ▼                   ▼
              Workers KV    CF REST API         Workers AI
           (app HTML store,  (D1, R2, KV,       (LLM + Vision)
            resource index,   Workers Scripts)
            request logs)
```

All Cloudflare resources (databases, buckets, auth Workers) are provisioned at runtime by the MCP server itself using your `CF_API_TOKEN`. No pre-existing bindings are needed beyond the one KV namespace used internally.

---

## Self-Hosting

### Prerequisites

- Cloudflare account (free tier works for most features; R2 requires a credit card)
- Node.js 18+
- API token with these permissions:
  - Account: Workers Scripts **Edit**, D1 **Edit**, R2 Storage **Edit**, Workers KV **Edit**
  - Zone (or Account): Pages **Edit**
  - Workers AI **Edit** (or Read)
  - Queues **Edit** (optional, for future tools)

### Quick setup

```bash
git clone https://github.com/YOUR_USERNAME/cloudflare-deployer
cd cloudflare-deployer
npm install
bash setup.sh
```

`setup.sh` will:
1. Create the Pages project in your account
2. Create and bind a KV namespace
3. Generate and upload all secrets
4. Deploy the site

At the end it prints the MCP URL and OAuth credentials to paste into Claude.ai.

### Manual setup

If you prefer step-by-step:

```bash
# 1. Create Pages project (one time, via Cloudflare dashboard or wrangler)
wrangler pages project create my-deployer

# 2. Create KV namespace and note the ID
wrangler kv namespace create APPS

# 3. Paste the KV ID into wrangler.toml under [[kv_namespaces]]

# 4. Set required secrets
wrangler pages secret put DEPLOY_AUTH_KEY    --project-name=my-deployer
wrangler pages secret put DEPLOY_AUTH_KEY_2  --project-name=my-deployer
wrangler pages secret put OAUTH_CLIENT_1_ID  --project-name=my-deployer
wrangler pages secret put OAUTH_CLIENT_1_SECRET --project-name=my-deployer
wrangler pages secret put OAUTH_CLIENT_2_ID  --project-name=my-deployer
wrangler pages secret put OAUTH_CLIENT_2_SECRET --project-name=my-deployer
wrangler pages secret put MCP_SECRET         --project-name=my-deployer
wrangler pages secret put CF_API_TOKEN       --project-name=my-deployer
wrangler pages secret put CF_ACCOUNT_ID      --project-name=my-deployer

# 5. Deploy
npm run deploy
```

### Secrets reference

| Secret | Description |
|--------|-------------|
| `DEPLOY_AUTH_KEY` | REST API key for user 1 (`X-Auth-Key` header) |
| `DEPLOY_AUTH_KEY_2` | REST API key for user 2 |
| `OAUTH_CLIENT_1_ID` | OAuth client ID for user 1 |
| `OAUTH_CLIENT_1_SECRET` | OAuth client secret for user 1 |
| `OAUTH_CLIENT_2_ID` | OAuth client ID for user 2 |
| `OAUTH_CLIENT_2_SECRET` | OAuth client secret for user 2 |
| `MCP_SECRET` | URL-path secret — forms part of the MCP URL |
| `CF_API_TOKEN` | Cloudflare API token (used at runtime to provision resources) |
| `CF_ACCOUNT_ID` | Your Cloudflare account ID |

---

## Connecting to Claude.ai

Go to **Settings → Integrations → Add custom connector**:

| Field | Value |
|-------|-------|
| Name | Cloudflare Deployer |
| URL | `https://YOUR_PROJECT.pages.dev/mcp/YOUR_MCP_SECRET` |
| OAuth Client ID | your `OAUTH_CLIENT_1_ID` value |
| OAuth Client Secret | your `OAUTH_CLIENT_1_SECRET` value |

A browser popup will appear — click **Allow access**.

### System prompt

Paste this into your Claude.ai Project instructions:

```
You have access to a Cloudflare deployment MCP with these tools:

deploy_app(projectName, htmlContent) — deploys a complete HTML/CSS/JS app to a live URL instantly
chat_with_ai(prompt, context?) — chat with an LLM via Workers AI
analyze_card(imageUrl) — analyze a trading card image and return structured data
create_d1_schema(appName, schemaType) — create a D1 SQLite database
query_d1(appName, sql, params?) — run SQL queries
create_kv_namespace(appName) — create a KV store
create_r2_bucket(appName) — create an R2 storage bucket
generate_signed_url(bucketName, objectKey, expiresInHours) — time-limited file URL
setup_authentication(appName) — deploy a JWT auth Worker (signup/login/validate/logout)
set_environment_secrets(workerName, secrets) — store API keys securely
setup_cors(appName, allowedDomains) — generate CORS headers
list_mcp_capabilities() — show all tools
get_logs() — view recent server logs for debugging

When a user asks you to build and deploy an app:
1. Build it as a single self-contained HTML file (inline all CSS and JS)
2. Call deploy_app — the user gets a live URL immediately
3. For apps needing a database or auth, call create_d1_schema and setup_authentication first

Never ask the user to run commands or touch a terminal.
```

---

## MCP tools reference

| Tool | Parameters | Description |
|------|-----------|-------------|
| `ping` | — | Health check and config summary |
| `get_logs` | `limit?` | Last N request logs (default 20) |
| `list_mcp_capabilities` | — | Describe all tools |
| `deploy_app` | `projectName`, `htmlContent` | Store HTML in KV; serve at `/apps/{name}` |
| `create_d1_schema` | `appName`, `schemaType` | Create D1 database (`pokemon` or `generic`) |
| `query_d1` | `appName`, `sql`, `params?` | Run SQL via CF REST API |
| `create_kv_namespace` | `appName` | Create KV namespace |
| `create_r2_bucket` | `appName` | Create R2 bucket |
| `generate_signed_url` | `bucketName`, `objectKey`, `expiresInHours` | HMAC-signed proxy URL |
| `setup_authentication` | `appName` | Deploy JWT auth Worker to `{appName}-auth.workers.dev` |
| `set_environment_secrets` | `workerName`, `secrets` | Push env vars to a Worker |
| `setup_cors` | `appName`, `allowedDomains` | Return CORS header config |
| `chat_with_ai` | `prompt`, `context?` | LLM via `@cf/meta/llama-3.1-8b-instruct` |
| `analyze_card` | `imageUrl` | Vision via `@cf/llava-hf/llava-1.5-7b-hf` |

---

## REST API

Deploy without Claude:

```bash
curl -X POST https://YOUR_PROJECT.pages.dev/deploy \
  -H "Content-Type: application/json" \
  -H "X-Auth-Key: YOUR_DEPLOY_AUTH_KEY" \
  -d '{"projectName":"my-app","htmlContent":"<!DOCTYPE html><html>...</html>"}'
```

Response:
```json
{ "url": "https://YOUR_PROJECT.pages.dev/apps/my-app" }
```

---

## Local development

```bash
cp .dev.vars.example .dev.vars
# Fill in .dev.vars with real values
npm run dev
```

The local server starts on `http://localhost:8788`. MCP endpoint: `http://localhost:8788/mcp/YOUR_MCP_SECRET`.

---

## Security notes

- The MCP secret lives in the URL path. It never appears in response bodies or logs.
- Claude.ai's MCP implementation does not forward OAuth Bearer tokens on individual tool calls, so URL-path auth is the only mechanism that works (as of mid-2026).
- The secret is only visible to: you (you set it), Cloudflare (it's a Pages secret), and Claude.ai (it stores the connector URL). It is not sent to any third party.
- Both auth keys use constant-time comparison to prevent timing attacks.
- Auth Workers use PBKDF2 (100,000 iterations, SHA-256) for password hashing and HMAC-SHA256 for JWTs.

---

## File structure

```
cloudflare-deployer/
├── public/                     # Static assets (Pages build output)
│   └── index.html              # Landing page
├── functions/                  # Pages Functions (file-based routing)
│   ├── mcp/
│   │   └── [secret].ts         # MCP server — all 14 tools
│   ├── apps/
│   │   └── [name].ts           # Serves deployed apps from KV
│   ├── authorize.ts            # OAuth consent page
│   ├── token.ts                # OAuth token exchange (PKCE)
│   ├── deploy.ts               # REST deploy endpoint
│   ├── .well-known/
│   │   └── oauth-authorization-server.ts
│   └── lib/
│       ├── auth.ts             # Auth key helpers
│       ├── cf-api.ts           # Cloudflare REST API wrapper
│       ├── kv-deploy.ts        # KV store/retrieve helpers
│       └── logger.ts           # KV-based request logging
├── setup.sh                    # One-command setup script
├── wrangler.toml               # Cloudflare project config
├── .dev.vars.example           # Local dev secrets template
└── package.json
```

---

## License

MIT
