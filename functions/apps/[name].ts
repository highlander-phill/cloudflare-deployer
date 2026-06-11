interface Env {
  APPS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const name = params.name as string;
  const html = await env.APPS.get(`app:${name}`);

  if (!html) {
    return new Response("App not found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      // Allow embedding in iframes (useful for preview)
      "x-frame-options": "SAMEORIGIN",
    },
  });
};
