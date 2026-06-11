# Claude.ai MCP Connector — Setup

## Add the MCP Server in Claude.ai

Settings → Integrations → Add MCP Server (or "Add custom connector"):

| Field | Value |
|---|---|
| **Name** | Cloudflare Deployer |
| **URL** | `https://<YOUR_PAGES_DOMAIN>/mcp/<YOUR_MCP_SECRET>` |
| **OAuth Client ID** | *(from your `.dev.vars` or Pages secrets)* |
| **OAuth Client Secret** | *(from your `.dev.vars` or Pages secrets)* |

A browser popup will appear — click **Allow access**.

---

## System Prompt (paste into Claude.ai Project instructions)

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

## Example Prompts

```
Build and deploy a Pomodoro timer
Make a mortgage calculator and publish it live
Create a Pokemon card collection app with a database and login
Analyse this card: [image URL]
What's in my collection? [after adding cards to D1]
```

---

## REST API

```bash
curl -X POST https://<YOUR_PAGES_DOMAIN>/deploy \
  -H "Content-Type: application/json" \
  -H "X-Auth-Key: <DEPLOY_AUTH_KEY>" \
  -d '{"projectName":"my-app","htmlContent":"<!DOCTYPE html>..."}'
```

---

## Redeploy the MCP Server

```bash
export CLOUDFLARE_API_TOKEN="<your token>"
export CLOUDFLARE_ACCOUNT_ID="<your account id>"
wrangler pages deploy public --project-name=<your-project-name>
```
