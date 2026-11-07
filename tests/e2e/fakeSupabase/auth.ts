// The fake's GoTrue (`/auth/v1/`): emailed codes, sessions with a decodable JWT, refresh, logout. Test fixtures only:
// the tokens are unsigned and mean something only to this fake.
import type { Reply } from "./http";

/** The code every emailed sign-in carries. */
export const SIGN_IN_CODE = "123456";

const EXPIRES_IN = 3600;

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

interface Token {
  userId: string;
  sessionId: string;
  /** Seconds since the epoch; the access token only. */
  exp?: number;
}

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** GoTrue's error shape: auth-js reads `code` (or `error_code`) and `msg`. */
const authError = (status: number, code: string, msg: string): Reply => ({
  status,
  body: { code, error_code: code, msg },
});

export class FakeAuth {
  /** By email, lower-cased. */
  readonly users = new Map<string, User>();
  /** Every sign-in email asked for, in order. */
  readonly emailsSent: { email: string; redirectTo: string | null }[] = [];
  private readonly accessTokens = new Map<string, Token>();
  private readonly refreshTokens = new Map<string, Token>();

  /** The account behind `email`, made on first use, as GoTrue does for `create_user`. */
  addUser(email: string): User {
    const key = email.trim().toLowerCase();
    let user = this.users.get(key);
    if (!user) {
      user = { id: crypto.randomUUID(), email: key, createdAt: new Date().toISOString() };
      this.users.set(key, user);
    }
    return user;
  }

  /** The user an `Authorization: Bearer <access token>` header names, if the token is one this fake issued and live. */
  userFor(authorization: string | undefined): User | null {
    const token = /^Bearer (.+)$/i.exec(authorization ?? "")?.[1];
    const issued = token === undefined ? undefined : this.accessTokens.get(token);
    if (!issued || (issued.exp ?? 0) <= Date.now() / 1000) return null;
    return [...this.users.values()].find((user) => user.id === issued.userId) ?? null;
  }

  handle(method: string, url: URL, authorization: string | undefined, body: Record<string, unknown>): Reply | null {
    const route = `${method} ${url.pathname.slice("/auth/v1".length)}`;
    switch (route) {
      case "POST /otp":
        return this.sendEmail(url, body);
      case "POST /verify":
        return this.verify(body);
      case "POST /token":
        return url.searchParams.get("grant_type") === "refresh_token" ? this.refresh(body) : null;
      case "GET /user": {
        const user = this.userFor(authorization);
        return user ? { status: 200, body: userJson(user) } : authError(401, "bad_jwt", "invalid JWT: unable to parse or verify signature");
      }
      case "POST /logout":
        return this.logout(url, authorization);
      default:
        return null;
    }
  }

  private sendEmail(url: URL, body: Record<string, unknown>): Reply {
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (email === "") return authError(400, "validation_failed", "To send a magic link, you need to provide an email address");
    if (body.create_user !== true && !this.users.has(email.toLowerCase())) {
      return authError(422, "otp_disabled", "Signups not allowed for otp");
    }
    this.addUser(email);
    this.emailsSent.push({ email, redirectTo: url.searchParams.get("redirect_to") });
    return { status: 200, body: {} };
  }

  private verify(body: Record<string, unknown>): Reply {
    const user = typeof body.email === "string" ? this.users.get(body.email.trim().toLowerCase()) : undefined;
    if (body.type !== "email" || !user || body.token !== SIGN_IN_CODE) {
      return authError(403, "otp_expired", "Token has expired or is invalid");
    }
    return { status: 200, body: this.issue(user, crypto.randomUUID()) };
  }

  private refresh(body: Record<string, unknown>): Reply {
    const token = typeof body.refresh_token === "string" ? body.refresh_token : "";
    const issued = this.refreshTokens.get(token);
    const user = issued && [...this.users.values()].find((u) => u.id === issued.userId);
    if (!issued || !user) return authError(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
    // Refresh tokens are single use: the new session carries the next one.
    this.refreshTokens.delete(token);
    return { status: 200, body: this.issue(user, issued.sessionId) };
  }

  private logout(url: URL, authorization: string | undefined): Reply {
    const token = /^Bearer (.+)$/i.exec(authorization ?? "")?.[1] ?? "";
    const issued = this.accessTokens.get(token);
    if (!issued) return authError(401, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    const scope = url.searchParams.get("scope") ?? "global";
    const ends = (t: Token) =>
      scope === "local" ? t.sessionId === issued.sessionId : scope === "others" ? t.userId === issued.userId && t.sessionId !== issued.sessionId : t.userId === issued.userId;
    for (const tokens of [this.accessTokens, this.refreshTokens]) {
      for (const [key, t] of tokens) if (ends(t)) tokens.delete(key);
    }
    return { status: 204 };
  }

  /** A GoTrue session for `user`: a JWT auth-js can decode, and a refresh token. */
  private issue(user: User, sessionId: string) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + EXPIRES_IN;
    const payload = {
      aud: "authenticated",
      exp,
      iat: now,
      sub: user.id,
      email: user.email,
      role: "authenticated",
      aal: "aal1",
      amr: [{ method: "otp", timestamp: now }],
      session_id: sessionId,
      is_anonymous: false,
      // Two sessions issued in the same second still differ.
      jti: crypto.randomUUID(),
    };
    const accessToken = `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(payload)}.${Buffer.from("fake-signature").toString("base64url")}`;
    const refreshToken = crypto.randomUUID().replace(/-/g, "");
    this.accessTokens.set(accessToken, { userId: user.id, sessionId, exp });
    this.refreshTokens.set(refreshToken, { userId: user.id, sessionId });
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: EXPIRES_IN,
      expires_at: exp,
      refresh_token: refreshToken,
      user: userJson(user),
    };
  }
}

function userJson(user: User) {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: user.createdAt,
    phone: "",
    confirmed_at: user.createdAt,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: user.createdAt,
    updated_at: user.createdAt,
    is_anonymous: false,
  };
}
