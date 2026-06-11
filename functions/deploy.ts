import { deployToKV } from "./lib/kv-deploy";
import { isAuthorized, getAuthKey } from "./lib/auth";

interface Env {
  APPS: KVNamespace;
  DEPLOY_AUTH_KEY: string;
  DEPLOY_AUTH_KEY_2?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAuthorized(getAuthKey(request), env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { projectName?: string; htmlContent?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { projectName, htmlContent } = body;
  if (!projectName || !htmlContent) {
    return json({ error: "projectName and htmlContent are required" }, 400);
  }

  const origin = new URL(request.url).origin;

  try {
    const result = await deployToKV(projectName, htmlContent, env.APPS, origin);
    return json({ success: true, ...result });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
};
