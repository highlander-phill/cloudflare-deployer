import { log } from "./lib/logger";

interface Env {
  APPS: KVNamespace;
  OAUTH_CLIENT_1_ID: string;
  OAUTH_CLIENT_2_ID: string;
}

function isValidClient(clientId: string, env: Env): boolean {
  return clientId === env.OAUTH_CLIENT_1_ID || clientId === env.OAUTH_CLIENT_2_ID;
}

function authPage(fields: Record<string, string>): Response {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
    .join("\n    ");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare Deployer — Allow Access</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.10); padding: 40px 36px; max-width: 420px; width: 100%; }
    .logo { font-size: 1.6rem; font-weight: 700; color: #f6821f; margin-bottom: 8px; }
    h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 8px; }
    p { color: #555; font-size: 0.9rem; margin: 0 0 28px; line-height: 1.5; }
    .scope { background: #f9f9f9; border: 1px solid #eee; border-radius: 8px; padding: 12px 16px; font-size: 0.85rem; color: #333; margin-bottom: 28px; }
    .scope strong { display: block; margin-bottom: 4px; }
    .actions { display: flex; gap: 12px; }
    button { flex: 1; padding: 11px; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; border: none; }
    .allow { background: #f6821f; color: #fff; }
    .allow:hover { background: #e07318; }
    .deny { background: #f0f0f0; color: #333; }
    .deny:hover { background: #e0e0e0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">&#9729; Cloudflare Deployer</div>
    <h1>Allow access?</h1>
    <p>An application wants to deploy web apps on your behalf.</p>
    <div class="scope"><strong>Permission requested:</strong> Deploy and update web apps to your Cloudflare account</div>
    <form method="POST">
      ${inputs}
      <div class="actions">
        <button type="submit" name="action" value="allow" class="allow">Allow access</button>
        <button type="submit" name="action" value="deny" class="deny">Deny</button>
      </div>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const p = url.searchParams;
  const client_id = p.get("client_id") ?? "";
  const redirect_uri = p.get("redirect_uri") ?? "";
  const state = p.get("state") ?? "";
  const code_challenge = p.get("code_challenge") ?? "";
  const code_challenge_method = p.get("code_challenge_method") ?? "S256";
  const response_type = p.get("response_type") ?? "";

  if (!isValidClient(client_id, env)) {
    await log(env.APPS, "authorize", `GET — invalid client_id: "${client_id}"`, false);
    return new Response("Invalid client_id", { status: 400 });
  }
  if (!redirect_uri || !code_challenge || response_type !== "code") {
    await log(env.APPS, "authorize", `GET — missing params: redirect_uri=${!!redirect_uri} code_challenge=${!!code_challenge} response_type=${response_type}`, false);
    return new Response("Missing required parameters", { status: 400 });
  }

  await log(env.APPS, "authorize", `GET — showing consent page for client_id="${client_id}" redirect_uri="${redirect_uri}"`, true);
  return authPage({ client_id, redirect_uri, state, code_challenge, code_challenge_method });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const client_id = (form.get("client_id") as string) ?? "";
  const redirect_uri = (form.get("redirect_uri") as string) ?? "";
  const state = (form.get("state") as string) ?? "";
  const code_challenge = (form.get("code_challenge") as string) ?? "";
  const action = (form.get("action") as string) ?? "";

  if (!isValidClient(client_id, env) || !redirect_uri) {
    await log(env.APPS, "authorize", `POST — invalid client_id="${client_id}" or missing redirect_uri`, false);
    return new Response("Invalid request", { status: 400 });
  }

  const redirectUrl = new URL(redirect_uri);

  if (action !== "allow") {
    await log(env.APPS, "authorize", `POST — user denied access for client_id="${client_id}"`, false);
    redirectUrl.searchParams.set("error", "access_denied");
    if (state) redirectUrl.searchParams.set("state", state);
    return Response.redirect(redirectUrl.toString(), 302);
  }

  const codeBytes = new Uint8Array(24);
  crypto.getRandomValues(codeBytes);
  const code = [...codeBytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  await env.APPS.put(
    `oauth:code:${code}`,
    JSON.stringify({ client_id, redirect_uri, code_challenge, created_at: Date.now() }),
    { expirationTtl: 300 }
  );

  await log(env.APPS, "authorize", `POST — issued code for client_id="${client_id}", redirecting to ${redirect_uri}`, true);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);
  return Response.redirect(redirectUrl.toString(), 302);
};
