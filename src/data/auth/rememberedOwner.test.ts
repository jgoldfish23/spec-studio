import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../local/memoryStorage";
import { createFakeAuth, FAKE_CODE } from "../testing/fakeAuth";
import { AuthError } from "./authGateway";
import type { AuthUser } from "./authGateway";
import type { Company } from "./companyGateway";
import {
  createOwnerMemory,
  REMEMBERED_OWNER_WAIT_MS,
  rememberingOwner,
} from "./rememberedOwner";

const ANA: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ana@example.com",
};
const BEN: AuthUser = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "ben@example.com",
};
const ANA_CO: Company = {
  id: "c0ffee00-0000-4000-8000-000000000001",
  name: "Ana Homes",
  defaultRegion: "utah-north",
};
const LAST_USER = "spec-studio:last-user";
const anaCompanyKey = `spec-studio:company:${ANA.id}`;

/** A store that refuses every write, as a full or blocked one does. */
class RefusingStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException("full", "QuotaExceededError");
  }
  override removeItem(): void {
    throw new DOMException("blocked", "SecurityError");
  }
}

/** A store that cannot even be read. */
class UnreadableStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new DOMException("blocked", "SecurityError");
  }
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("the remembered owner", () => {
  it("keeps the owner's id and email, and forgets them", () => {
    const storage = new MemoryStorage();
    const memory = createOwnerMemory(storage);
    expect(memory.owner()).toBeNull();
    memory.rememberOwner({ ...ANA, extra: "not kept" } as AuthUser);
    expect(JSON.parse(storage.getItem(LAST_USER) ?? "null")).toEqual(ANA);
    expect(createOwnerMemory(storage).owner()).toEqual(ANA);
    memory.forgetOwner();
    expect(storage.getItem(LAST_USER)).toBeNull();
    expect(memory.owner()).toBeNull();
  });

  it.each([
    ["not JSON", "{oops"],
    ["the wrong shape", JSON.stringify({ id: 7, email: "ana@example.com" })],
    ["an empty id", JSON.stringify({ id: "", email: "ana@example.com" })],
    ["null", "null"],
  ])("ignores %s, and says so once", (_name, raw) => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_USER, raw);
    const memory = createOwnerMemory(storage);
    expect(memory.owner()).toBeNull();
    expect(memory.owner()).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("never throws from a store that refuses writes, and says so once", () => {
    const memory = createOwnerMemory(new RefusingStorage());
    expect(() => memory.rememberOwner(ANA)).not.toThrow();
    expect(() => memory.rememberOwner(ANA)).not.toThrow();
    expect(() => memory.forgetOwner()).not.toThrow();
    expect(memory.owner()).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("reads nothing, without throwing, from a store that cannot be read", () => {
    const memory = createOwnerMemory(new UnreadableStorage());
    expect(memory.owner()).toBeNull();
    expect(memory.company(ANA.id)).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe("the remembered company", () => {
  it("is kept per owner", () => {
    const storage = new MemoryStorage();
    const memory = createOwnerMemory(storage);
    memory.rememberCompany(ANA.id, ANA_CO);
    expect(JSON.parse(storage.getItem(anaCompanyKey) ?? "null")).toEqual(
      ANA_CO,
    );
    expect(createOwnerMemory(storage).company(ANA.id)).toEqual(ANA_CO);
    expect(memory.company(BEN.id)).toBeNull();
    memory.forgetCompany(ANA.id);
    expect(storage.getItem(anaCompanyKey)).toBeNull();
  });

  it("ignores a company of the wrong shape, and says so once", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      anaCompanyKey,
      JSON.stringify({ id: ANA_CO.id, name: "Ana Homes" }),
    );
    const memory = createOwnerMemory(storage);
    expect(memory.company(ANA.id)).toBeNull();
    expect(memory.company(ANA.id)).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("is kept when the owner is forgotten", () => {
    const memory = createOwnerMemory(new MemoryStorage());
    memory.rememberOwner(ANA);
    memory.rememberCompany(ANA.id, ANA_CO);
    memory.forgetOwner();
    expect(memory.company(ANA.id)).toEqual(ANA_CO);
  });
});

describe("rememberingOwner", () => {
  function setup(user?: AuthUser) {
    const storage = new MemoryStorage();
    const memory = createOwnerMemory(storage);
    const auth = createFakeAuth(user ? { user } : {});
    return { storage, memory, auth, gateway: rememberingOwner(auth, memory) };
  }

  it("remembers the owner the stored session reads as, and forgets when there is none", async () => {
    const { memory, gateway, auth } = setup(ANA);
    expect(await gateway.currentUser()).toEqual(ANA);
    expect(memory.owner()).toEqual(ANA);
    await auth.signOut();
    expect(await gateway.currentUser()).toBeNull();
    expect(memory.owner()).toBeNull();
  });

  it("reads as the remembered owner when the session can't be read offline", async () => {
    const { memory, gateway, auth } = setup(ANA);
    memory.rememberOwner(ANA);
    vi.spyOn(auth, "currentUser").mockRejectedValue(new AuthError("offline"));
    expect(await gateway.currentUser()).toEqual(ANA);
  });

  it("still fails offline with no one remembered", async () => {
    const { gateway, auth } = setup(ANA);
    vi.spyOn(auth, "currentUser").mockRejectedValue(new AuthError("offline"));
    await expect(gateway.currentUser()).rejects.toMatchObject({
      reason: "offline",
    });
  });

  it("does not hide any other failure behind the remembered owner", async () => {
    const { memory, gateway, auth } = setup(ANA);
    memory.rememberOwner(ANA);
    vi.spyOn(auth, "currentUser").mockRejectedValue(new AuthError("failed"));
    await expect(gateway.currentUser()).rejects.toMatchObject({
      reason: "failed",
    });
  });

  it("remembers each sign-in and forgets each sign-out it hears, and passes them on", async () => {
    const { memory, gateway, auth } = setup();
    const heard: (string | null)[] = [];
    const stop = gateway.onChange((user) => heard.push(user?.email ?? null));
    await auth.verifyCode(BEN.email, FAKE_CODE);
    expect(memory.owner()?.email).toBe(BEN.email);
    await auth.signOut();
    expect(memory.owner()).toBeNull();
    stop();
    expect(heard).toEqual([BEN.email, null]);
  });

  it("forgets the owner on an explicit sign-out, even one that fails", async () => {
    const { memory, gateway, auth } = setup(ANA);
    memory.rememberOwner(ANA);
    vi.spyOn(auth, "signOut").mockRejectedValue(new AuthError("offline"));
    await expect(gateway.signOut()).rejects.toMatchObject({
      reason: "offline",
    });
    expect(memory.owner()).toBeNull();
  });

  it("passes the rest through", async () => {
    const { gateway, auth } = setup();
    await gateway.sendSignInEmail(ANA.email, "http://app.test/");
    expect(auth.sent).toEqual([
      { email: ANA.email, redirectTo: "http://app.test/" },
    ]);
    expect((await gateway.verifyCode(ANA.email, FAKE_CODE)).email).toBe(
      ANA.email,
    );
    expect((await gateway.exchangeLinkCode(BEN.email)).email).toBe(BEN.email);
  });
});

describe("rememberingOwner when the session read is slow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A gateway whose session read answers only when the test says, with Ana remembered on the device. */
  function slow(remembered: AuthUser | null = ANA) {
    const memory = createOwnerMemory(new MemoryStorage());
    if (remembered) memory.rememberOwner(remembered);
    const auth = createFakeAuth({ user: ANA });
    let answer!: (user: AuthUser | null) => void;
    let fail!: (error: unknown) => void;
    vi.spyOn(auth, "currentUser").mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          answer = resolve;
          fail = reject;
        }),
    );
    const gateway = rememberingOwner(auth, memory);
    const heard: (string | null)[] = [];
    gateway.onChange((user) => heard.push(user?.email ?? null));
    let read: AuthUser | null | undefined;
    void gateway.currentUser().then((user) => (read = user));
    return {
      memory,
      heard,
      answer: (user: AuthUser | null) => answer(user),
      fail: (error: unknown) => fail(error),
      read: () => read,
    };
  }

  it("waits 5 s, then reads as the remembered owner", async () => {
    const { read } = slow();
    await vi.advanceTimersByTimeAsync(REMEMBERED_OWNER_WAIT_MS - 1);
    expect(read()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(read()).toEqual(ANA);
  });

  it("then hears nothing when the read later finds the same owner", async () => {
    const { heard, answer } = slow();
    await vi.advanceTimersByTimeAsync(REMEMBERED_OWNER_WAIT_MS);
    answer({ ...ANA });
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([]);
  });

  it("then says signed out when the read later finds no session", async () => {
    const { heard, answer, memory } = slow();
    await vi.advanceTimersByTimeAsync(REMEMBERED_OWNER_WAIT_MS);
    answer(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([null]);
    expect(memory.owner()).toBeNull();
  });

  it("then follows a different owner the read later finds", async () => {
    const { heard, answer, memory } = slow();
    await vi.advanceTimersByTimeAsync(REMEMBERED_OWNER_WAIT_MS);
    answer(BEN);
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([BEN.email]);
    expect(memory.owner()).toEqual(BEN);
  });

  it("then stays when the read later fails offline, and says signed out when it fails otherwise", async () => {
    const offline = slow();
    await vi.advanceTimersByTimeAsync(REMEMBERED_OWNER_WAIT_MS);
    offline.fail(new AuthError("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(offline.heard).toEqual([]);

    const failed = slow();
    await vi.advanceTimersByTimeAsync(REMEMBERED_OWNER_WAIT_MS);
    failed.fail(new AuthError("failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(failed.heard).toEqual([null]);
  });

  it("answers as the read does when it is in time, leaving no timer behind", async () => {
    const { read, answer, heard } = slow();
    answer(BEN);
    await vi.advanceTimersByTimeAsync(0);
    expect(read()).toEqual(BEN);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(REMEMBERED_OWNER_WAIT_MS);
    expect(heard).toEqual([]);
  });

  it("waits for the read with no one remembered", async () => {
    const { read, answer } = slow(null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read()).toBeUndefined();
    answer(ANA);
    await vi.advanceTimersByTimeAsync(0);
    expect(read()).toEqual(ANA);
  });
});
