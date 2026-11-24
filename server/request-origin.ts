// Cookie-authenticated writes must come from this deployment's exact origin.
export function sameOrigin(request: Request): boolean {
  const configured = process.env.BETTER_AUTH_URL;
  const origin = request.headers.get("origin");
  if (!configured || !origin) return false;
  try { return origin === new URL(configured).origin; }
  catch { return false; }
}
