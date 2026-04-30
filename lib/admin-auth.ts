export function isAdminRequest(request: Request) {
  const expectedToken = process.env.ADMIN_TOKEN;
  if (!expectedToken) return true;

  const headerToken = request.headers.get("x-admin-token");
  const authorization = request.headers.get("authorization");
  const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

  return headerToken === expectedToken || bearerToken === expectedToken;
}
