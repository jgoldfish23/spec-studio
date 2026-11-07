import { AuthError, authErrorFrom } from "../../data/auth/authGateway";
import type { AuthGateway } from "../../data/auth/authGateway";

/** Where a magic link should come back to: this page, with no query and no hash. */
export function redirectUrl(location: Location): string {
  return location.origin + location.pathname;
}

/**
 * Finishes a sign-in when the page was opened from an emailed link (`?code=`). The code is stripped from the URL
 * whether or not it worked, so a reload never retries a spent one. The hash route stays, or becomes `#/deals`.
 */
export async function handleLinkCallback(
  location: Location,
  auth: AuthGateway,
): Promise<{ handled: boolean; error?: AuthError }> {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) return { handled: false };
  const hash = location.hash || "#/deals";
  const url = location.origin + location.pathname + hash;
  try {
    await auth.exchangeLinkCode(code);
    return { handled: true };
  } catch (error) {
    return { handled: true, error: authErrorFrom(error) };
  } finally {
    window.history.replaceState(null, "", url);
  }
}
