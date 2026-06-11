#!/usr/bin/env bash
# One-time setup script for cloudflare-deployer
# Run: bash setup.sh

set -e

echo "🚀 Cloudflare Deployer — Setup"
echo ""

# Check wrangler
if ! command -v wrangler &>/dev/null && [ ! -f node_modules/.bin/wrangler ]; then
  echo "Installing dependencies..."
  npm install
fi
WRANGLER="${WRANGLER:-./node_modules/.bin/wrangler}"

# Cloudflare credentials
echo "Enter your Cloudflare credentials:"
read -p "  Account ID: " CF_ACCOUNT_ID
read -p "  API Token:  " CF_API_TOKEN
read -p "  Pages project name (e.g. my-deployer): " PROJECT_NAME

export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"

# Create Pages project
echo ""
echo "Creating Pages project '$PROJECT_NAME'..."
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${PROJECT_NAME}\",\"production_branch\":\"main\"}" | python3 -c "
import sys,json
r=json.load(sys.stdin)
if r.get('success'):
    print('  ✓ Project created: '+r['result'].get('subdomain',''))
else:
    print('  ✗ '+str(r.get('errors','')))
"

# Create KV namespace
echo "Creating KV namespace..."
KV_ID=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"${PROJECT_NAME}-apps\"}" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['result']['id'] if r.get('success') else '')")
echo "  ✓ KV namespace: $KV_ID"

# Patch wrangler.toml with KV ID
sed -i.bak "s/id = \".*\"/id = \"${KV_ID}\"/" wrangler.toml && rm wrangler.toml.bak
echo "  ✓ wrangler.toml updated"

# Generate secrets
echo ""
echo "Generating secrets..."
AUTH_KEY_1=$(python3 -c "import secrets; print(secrets.token_hex(32))")
AUTH_KEY_2=$(python3 -c "import secrets; print(secrets.token_hex(32))")
CLIENT_1_ID="deployer-$(python3 -c "import secrets; print(secrets.token_hex(4))")"
CLIENT_1_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(24))")
CLIENT_2_ID="deployer-$(python3 -c "import secrets; print(secrets.token_hex(4))")"
CLIENT_2_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(24))")
read -sp "  MCP secret password (shown once): " MCP_SECRET && echo ""

# Upload secrets
echo "Uploading secrets to Cloudflare Pages..."
for VAR_NAME in DEPLOY_AUTH_KEY DEPLOY_AUTH_KEY_2 OAUTH_CLIENT_1_ID OAUTH_CLIENT_1_SECRET OAUTH_CLIENT_2_ID OAUTH_CLIENT_2_SECRET MCP_SECRET CF_API_TOKEN CF_ACCOUNT_ID; do
  VALUE="${!VAR_NAME}"
  printf '%s' "$VALUE" | $WRANGLER pages secret put "$VAR_NAME" --project-name="$PROJECT_NAME" 2>&1 | grep -E "Success|Error" || true
done

# Bind KV to project
curl -s -X PATCH "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"deployment_configs\":{\"production\":{\"kv_namespaces\":{\"APPS\":{\"namespace_id\":\"${KV_ID}\"}}}}}" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✓ KV bound' if r.get('success') else '  ✗ KV bind failed: '+str(r.get('errors','')))"

# Deploy
echo ""
echo "Deploying..."
$WRANGLER pages deploy public --project-name="$PROJECT_NAME"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup complete!"
echo ""
echo "Add to Claude.ai → Settings → Integrations:"
echo ""
echo "  MCP URL:          https://${PROJECT_NAME}.pages.dev/mcp/${MCP_SECRET}"
echo "  OAuth Client ID:  ${CLIENT_1_ID}"
echo "  OAuth Client Secret: ${CLIENT_1_SECRET}"
echo ""
echo "Second user credentials:"
echo "  OAuth Client ID:  ${CLIENT_2_ID}"
echo "  OAuth Client Secret: ${CLIENT_2_SECRET}"
echo ""
echo "REST API key (X-Auth-Key header): ${AUTH_KEY_1}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
