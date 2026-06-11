import { constantTimeEqual } from "./lib/auth";
import { log } from "./lib/logger";

interface Env {
  APPS: KVNamespace;
  OAUTH_CLIENT_1_ID: string;
  OAUTH_CLIENT_1_SECRET: string;
  OAUTH_CLIENT_2_ID: string;
  OAUTH_CLIENT_2_SECRET: string;
  DEPLOY_AUTH_KEY: string;
  DEPLOY_AUTH_KEY_2?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const text = await request.text();
  const params = new URLSearchParams(text);

  const grant_type = params.get("grant_type");
  const code = params.get("code");
  const code_verifier = params.get("code_verifier");
  const client_id = params.get("client_id") ?? "";
  const client_secret = params.get("client_secret") ?? "";
  const redirect_uri = params.get("redirect_uri") ?? "";

  if (grant_type !== "authorization_code") {
    await log(env.APPS, "token", `unsupported grant_type: "${grant_type}"`, false);
    return Response.json({ error: "unsupported_grant_type" }, { status: 400, headers: CORS });
  }
  if (!code || !code_verifier || !client_id || !client_secret || !redirect_uri) {
    await log(env.APPS, "token", `invalid_request — missing params: code=${!!code} verifier=${!!code_verifier} client_id=${!!client_id} secret=${!!client_secret} redirect=${!!redirect_uri}`, false);
    return Response.json({ error: "invalid_request" }, { status: 400, headers: CORS });
  }

  // Match client credentials
  let expectedSecret: string | undefined;
  let accessToken: string | undefined;
  if (client_id === env.OAUTH_CLIENT_1_ID) {
    expectedSecret = env.OAUTH_CLIENT_1_SECRET;
    accessToken = env.DEPLOY_AUTH_KEY;
  } else if (client_id === env.OAUTH_CLIENT_2_ID) {
    expectedSecret = env.OAUTH_CLIENT_2_SECRET;
    accessToken = env.DEPLOY_AUTH_KEY_2;
  }

  if (!expectedSecret || !accessToken || !constantTimeEqual(client_secret, expectedSecret)) {
    await log(env.APPS, "token", `invalid_client — client_id="${client_id}" known=${!!(expectedSecret)} secret_match=${!!(expectedSecret && constantTimeEqual(client_secret, expectedSecret))}`, false);
    return Response.json({ error: "invalid_client" }, { status: 401, headers: CORS });
  }

  // Look up and immediately consume the auth code
  const stored = await env.APPS.get(`oauth:code:${code}`);
  if (!stored) {
    await log(env.APPS, "token", `invalid_grant — code not found in KV (expired or already used): code=${code.slice(0,8)}...`, false);
    return Response.json({ error: "invalid_grant" }, { status: 400, headers: CORS });
  }

  const codeData = JSON.parse(stored) as {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    created_at: number;
  };

  await env.APPS.delete(`oauth:code:${code}`);

  if (codeData.client_id !== client_id || codeData.redirect_uri !== redirect_uri) {
    await log(env.APPS, "token", `invalid_grant — client_id or redirect_uri mismatch. stored_client="${codeData.client_id}" got="${client_id}" stored_redirect="${codeData.redirect_uri}" got="${redirect_uri}"`, false);
    return Response.json({ error: "invalid_grant" }, { status: 400, headers: CORS });
  }

  // Verify PKCE: base64url(SHA-256(code_verifier)) must equal code_challenge
  const verifierBytes = new TextEncoder().encode(code_verifier);
  const hashBuf = await crypto.subtle.digest("SHA-256", verifierBytes);
  const hashBase64url = btoa(String.fromCharCode(...new Uint8Array(hashBuf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  if (!constantTimeEqual(hashBase64url, codeData.code_challenge)) {
    await log(env.APPS, "token", `invalid_grant — PKCE mismatch. computed="${hashBase64url.slice(0,16)}..." stored="${codeData.code_challenge.slice(0,16)}..."`, false);
    return Response.json({ error: "invalid_grant" }, { status: 400, headers: CORS });
  }

  await log(env.APPS, "token", `success — issued access_token for client_id="${client_id}"`, true);
  return Response.json(
    { access_token: accessToken, token_type: "bearer", expires_in: 31536000 },
    { headers: CORS }
  );
};
