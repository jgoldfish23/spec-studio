import { AuthError } from "./authGateway";
import type { AuthGateway, AuthUser } from "./authGateway";
import type { Company } from "./companyGateway";

/** Who was last signed in on this device. Removed when that owner signs out. */
export const LAST_USER_KEY = "spec-studio:last-user";

/** The company of one owner, kept across sign-outs (it is not sensitive, and the owner's outbox is kept too). */
export const companyKey = (userId: string): string =>
  `spec-studio:company:${userId}`;

/**
 * What this device remembers of its owners, so a returning owner can open the app from the device while the server
 * can't be reached: who was last signed in, and each owner's company.
 */
export interface OwnerMemory {
  owner(): AuthUser | null;
  rememberOwner(user: AuthUser): void;
  forgetOwner(): void;
  company(userId: string): Company | null;
  rememberCompany(userId: string, company: Company): void;
  forgetCompany(userId: string): void;
}

const text = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

function asOwner(value: unknown): AuthUser | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, email } = value as Partial<AuthUser>;
  return text(id) && typeof email === "string" ? { id, email } : null;
}

function asCompany(value: unknown): Company | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, name, defaultRegion } = value as Partial<Company>;
  return text(id) && text(name) && text(defaultRegion)
    ? { id, name, defaultRegion }
    : null;
}

/**
 * Reads and writes what the device remembers, in `storage`. Reads check the shape: a value that does not read back is
 * ignored (and reported once), never thrown. Writes are best effort: a full or blocked store is reported once, and the
 * app goes on without it.
 */
export function createOwnerMemory(storage: Storage): OwnerMemory {
  let reportedRead = false;
  let reportedWrite = false;

  function read<T>(key: string, check: (value: unknown) => T | null): T | null {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
      if (raw === null) return null;
      const value = check(JSON.parse(raw));
      if (value === null) throw new Error(`${key} does not read back`);
      return value;
    } catch (error) {
      if (!reportedRead) {
        reportedRead = true;
        console.error(
          "What this device remembers of its owner could not be read; ignoring it.",
          error,
        );
      }
      return null;
    }
  }

  function write(change: () => void): void {
    try {
      change();
    } catch (error) {
      if (!reportedWrite) {
        reportedWrite = true;
        console.error(
          "What this device remembers of its owner could not be saved.",
          error,
        );
      }
    }
  }

  return {
    owner: () => read(LAST_USER_KEY, asOwner),
    rememberOwner: ({ id, email }) =>
      write(() =>
        storage.setItem(LAST_USER_KEY, JSON.stringify({ id, email })),
      ),
    forgetOwner: () => write(() => storage.removeItem(LAST_USER_KEY)),
    company: (userId) => read(companyKey(userId), asCompany),
    rememberCompany: (userId, { id, name, defaultRegion }) =>
      write(() =>
        storage.setItem(
          companyKey(userId),
          JSON.stringify({ id, name, defaultRegion }),
        ),
      ),
    forgetCompany: (userId) =>
      write(() => storage.removeItem(companyKey(userId))),
  };
}

/**
 * `auth`, remembering on this device who is signed in: each sign-in it reads or hears is remembered, and each
 * sign-out (heard, or asked for, whether or not it worked) forgets. When the stored session can't be read because the
 * server can't be reached (an expired token that can't be refreshed offline), it reads as the remembered owner, so a
 * returning owner opens the app from the device. With no one remembered, it still fails offline.
 */
export function rememberingOwner(
  auth: AuthGateway,
  memory: OwnerMemory,
): AuthGateway {
  const note = (user: AuthUser | null) => {
    if (user) memory.rememberOwner(user);
    else memory.forgetOwner();
  };
  return {
    async currentUser() {
      let user: AuthUser | null;
      try {
        user = await auth.currentUser();
      } catch (error) {
        const remembered =
          error instanceof AuthError && error.reason === "offline"
            ? memory.owner()
            : null;
        if (remembered) return remembered;
        throw error;
      }
      note(user);
      return user;
    },
    onChange: (listener) =>
      auth.onChange((user) => {
        note(user);
        listener(user);
      }),
    sendSignInEmail: (email, redirectTo) =>
      auth.sendSignInEmail(email, redirectTo),
    verifyCode: (email, code) => auth.verifyCode(email, code),
    exchangeLinkCode: (code) => auth.exchangeLinkCode(code),
    signOut() {
      memory.forgetOwner();
      return auth.signOut();
    },
  };
}
