export const onRequestGet: PagesFunction = async ({ request }) => {
  const origin = new URL(request.url).origin;
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    scopes_supported: ["deploy"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  }, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
};
