# Cloudflare Deployer MCP

If you've ever watched a kid spend three hours trying to figure out DNS records when they just wanted to show their friend the game they built — this is for that.

Cloudflare Deployer is an MCP server that lets Claude deploy full-stack web apps directly to Cloudflare, without the user ever opening a terminal. You describe what you want to build, Claude builds it, and it's live on a real URL. Databases, authentication, file storage — all of it, just by asking.

It's particularly good for teenagers learning to code. The vibe coding era means kids can build genuinely impressive things in an afternoon, but the moment they want to actually *share* it, they hit a wall of AWS consoles and CLI tools and SSH keys that has nothing to do with the thing they were excited about. This skips all of that.

---

## What it does

You connect this MCP server to Claude.ai once, and then Claude gains the ability to:

- Deploy a complete web app to a live public URL (usually under 5 seconds)
- Create a SQLite database and run queries against it
- Set up user accounts with login/signup/JWT auth
- Store files and images in R2 object storage
- Generate time-limited signed download links
- Run AI inference — chat completions and image analysis — via Workers AI
- Manage environment secrets for deployed workers

Everything runs on Cloudflare's free tier for most use cases. No credit card needed unless you want R2 storage.

---

## How it works

The MCP server is a Cloudflare Pages app. When Claude calls a tool, the Pages Function uses your Cloudflare API token (stored as a secret, never exposed) to provision whatever infrastructure the app needs — databases, buckets, auth workers — on the fly, in your account.

Apps get served at `your-project.pages.dev/apps/app-name`. Databases and auth workers live in your Cloudflare account. You own everything.

```
Claude.ai → MCP over HTTPS → Pages Function → Cloudflare REST API
                                            → Workers KV  (app HTML + logs)
                                            → D1          (databases)
                                            → R2          (file storage)
                                            → Workers AI  (LLM + vision)
                                            → Workers     (auth endpoints)
```

---

## Setting it up

You'll need a Cloudflare account (free) and an API token with these permissions:

- Workers Scripts: Edit
- Workers KV Storage: Edit
- D1: Edit
- R2 Storage: Edit
- Pages: Edit
- Workers AI: Read

### The quick way

```bash
git clone https://github.com/highlander-phill/cloudflare-deployer
cd cloudflare-deployer
npm install
bash setup.sh
```

The setup script walks you through everything — it creates the Pages project, generates secrets, binds the KV namespace, and deploys. At the end it prints the exact URL and credentials to paste into Claude.ai.

### If you'd rather do it yourself

```bash
# Create a KV namespace and note the ID
wrangler kv namespace create APPS

# Paste that ID into wrangler.toml, then set your secrets:
wrangler pages secret put MCP_SECRET          --project-name=your-project
wrangler pages secret put DEPLOY_AUTH_KEY     --project-name=your-project
wrangler pages secret put DEPLOY_AUTH_KEY_2   --project-name=your-project
wrangler pages secret put OAUTH_CLIENT_1_ID   --project-name=your-project
wrangler pages secret put OAUTH_CLIENT_1_SECRET --project-name=your-project
wrangler pages secret put CF_API_TOKEN        --project-name=your-project
wrangler pages secret put CF_ACCOUNT_ID       --project-name=your-project

# Deploy
wrangler pages deploy public --project-name=your-project
```

See `.dev.vars.example` for the full list of secrets and what each one is for.

---

## Connecting Claude.ai

Settings → Integrations → Add custom connector:

| Field | Value |
|---|---|
| Name | Cloudflare Deployer |
| URL | `https://your-project.pages.dev/mcp/your-mcp-secret` |
| OAuth Client ID | your `OAUTH_CLIENT_1_ID` value |
| OAuth Client Secret | your `OAUTH_CLIENT_1_SECRET` value |

A popup will ask you to allow access — click Allow.

Then paste this into your Claude.ai Project instructions so Claude knows what it can do:

```
You have access to a Cloudflare deployment MCP. When someone asks you to build
and deploy an app, build it as a single self-contained HTML file with all CSS
and JS inlined, then call deploy_app. The user gets a live URL immediately.

For apps that need a database, call create_d1_schema first.
For apps that need login/accounts, call setup_authentication first.
Never ask the user to run commands or open a terminal.

Available tools: deploy_app, create_d1_schema, query_d1, create_kv_namespace,
create_r2_bucket, generate_signed_url, setup_authentication,
set_environment_secrets, setup_cors, chat_with_ai, analyze_card,
list_mcp_capabilities, get_logs, ping
```

---

## Tools reference

| Tool | What it does |
|---|---|
| `deploy_app` | Deploys HTML/CSS/JS to `/apps/{name}`. Optionally provisions D1, KV, R2, and auth in the same call. |
| `create_d1_schema` | Creates a D1 SQLite database. Schema types: `pokemon` (cards, collections, users) or `generic`. |
| `query_d1` | Runs a SQL query against a previously created database. |
| `create_kv_namespace` | Creates a Workers KV namespace. |
| `create_r2_bucket` | Creates an R2 storage bucket. |
| `generate_signed_url` | Returns a time-limited URL for a file in R2. |
| `setup_authentication` | Deploys a JWT auth Worker with signup, login, validate, and logout endpoints. PBKDF2 password hashing, HMAC-SHA256 tokens. |
| `set_environment_secrets` | Pushes environment variables into a deployed Worker. |
| `setup_cors` | Returns the correct CORS header configuration for an app. |
| `chat_with_ai` | Calls `@cf/meta/llama-3.1-8b-instruct` via Workers AI. |
| `analyze_card` | Sends an image URL to `@cf/llava-hf/llava-1.5-7b-hf` for vision analysis. |
| `get_logs` | Returns recent request logs from KV (useful for debugging). |
| `ping` | Health check. |

---

## Security

The MCP secret sits in the URL path. This is intentional — Claude.ai's current MCP implementation doesn't forward OAuth Bearer tokens on individual tool calls (we discovered this the hard way), so header-based auth doesn't work. The URL-path secret does.

That said, it's a real secret and treated carefully:
- Compared with constant-time equality (no timing attacks)
- Never echoed in responses or logs
- As an alternative, you can also authenticate with an `X-Auth-Key` header — useful for other MCP clients or direct API calls

Auth workers use PBKDF2 (100,000 iterations, SHA-256) for passwords and HMAC-SHA256 for JWTs. These are the same primitives used in serious production systems.

---

## Local development

```bash
cp .dev.vars.example .dev.vars
# fill in real values
npm run dev
# MCP available at: http://localhost:8788/mcp/your-secret
```

---

## Project structure

```
functions/
  mcp/[secret].ts          — the MCP server (all tools live here)
  apps/[name].ts           — serves deployed apps from KV
  authorize.ts             — OAuth consent page
  token.ts                 — OAuth token exchange (PKCE/S256)
  deploy.ts                — REST deploy endpoint (/deploy)
  .well-known/             — OAuth server metadata
  lib/
    auth.ts                — auth key helpers
    cf-api.ts              — Cloudflare REST API wrapper
    kv-deploy.ts           — KV store/retrieve
    logger.ts              — request logging to KV
public/
  index.html               — landing page
setup.sh                   — one-command setup
wrangler.toml              — Cloudflare project config
```

---

## Example prompts (once connected)

- *Build me a Pomodoro timer and put it live*
- *Make a mortgage calculator I can share with my parents*
- *Create a Pokemon card tracker with a database and login — I want to be able to add cards and see my collection*
- *Analyse this card image and tell me what it's worth: [url]*
- *Build a simple quiz app for my revision*

---

MIT License
