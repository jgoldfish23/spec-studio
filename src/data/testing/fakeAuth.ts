import { AuthError } from "../auth/authGateway";
import type { AuthGateway, AuthUser } from "../auth/authGateway";
import type { Company, CompanyGateway } from "../auth/companyGateway";
import { DataError } from "../types";

export const FAKE_CODE = "123456";

export interface FakeAuth extends AuthGateway {
  /** Every `sendSignInEmail` call, in order. */
  sent: { email: string; redirectTo: string }[];
}

export interface FakeAuthOptions {
  user?: AuthUser;
  /** Methods that throw this error instead of working. */
  fail?: Partial<Record<keyof AuthGateway, AuthError>>;
}

/** A stable, valid v4-shaped id for an email, so the same address is the same user every time. */
export function fakeUserId(email: string): string {
  let h = 0;
  for (const ch of email.toLowerCase())
    h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const hex = h.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-${hex}0000`;
}

export function createFakeAuth(options: FakeAuthOptions = {}): FakeAuth {
  let user: AuthUser | null = options.user ?? null;
  const listeners = new Set<(user: AuthUser | null) => void>();
  const sent: FakeAuth["sent"] = [];
  const failIf = (method: keyof AuthGateway) => {
    const error = options.fail?.[method];
    if (error) throw error;
  };
  const set = (next: AuthUser | null) => {
    user = next;
    for (const listener of [...listeners]) listener(next);
  };
  return {
    sent,
    async currentUser() {
      failIf("currentUser");
      return user;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async sendSignInEmail(email, redirectTo) {
      failIf("sendSignInEmail");
      sent.push({ email, redirectTo });
    },
    async verifyCode(email, code) {
      failIf("verifyCode");
      if (code !== FAKE_CODE) throw new AuthError("badCode");
      const next = { id: fakeUserId(email), email };
      set(next);
      return next;
    },
    async exchangeLinkCode(code) {
      failIf("exchangeLinkCode");
      const email = code.includes("@") ? code : "link@example.com";
      const next = { id: fakeUserId(email), email };
      set(next);
      return next;
    },
    async signOut() {
      failIf("signOut");
      set(null);
    },
  };
}

/** Companies in memory, one per user id. `auth` says who is signed in. */
export function createFakeCompanies(
  auth?: Pick<AuthGateway, "currentUser">,
): CompanyGateway & {
  companies: Map<string, Company>;
} {
  const companies = new Map<string, Company>();
  const who = async (): Promise<string> => {
    const user = await auth?.currentUser();
    if (auth && !user)
      throw new DataError("You've been signed out.", { kind: "signedOut" });
    return user?.id ?? "fake-user";
  };
  return {
    companies,
    async myCompany() {
      return companies.get(await who()) ?? null;
    },
    async createCompany(name: string) {
      const id = await who();
      const trimmed = name.trim();
      if (trimmed === "" || trimmed.length > 120) {
        throw new DataError(
          "Enter a company name of 120 characters or fewer.",
          { kind: "failed" },
        );
      }
      if (companies.has(id))
        throw new DataError("You already have a company.", { kind: "failed" });
      const company = {
        id: `company-${companies.size + 1}`,
        name: trimmed,
        defaultRegion: "utah-north",
      };
      companies.set(id, company);
      return company;
    },
  };
}
