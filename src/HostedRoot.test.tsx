import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "./data/auth/authGateway";
import type { AuthUser } from "./data/auth/authGateway";
import type { Company } from "./data/auth/companyGateway";
import { createLocalRepository } from "./data/local/localRepository";
import { MemoryStorage } from "./data/local/memoryStorage";
import { createOfflineRepository } from "./data/offline/offlineRepository";
import { SAMPLE_DEAL_NAME, sampleDealInputs } from "./data/sample";
import {
  createFakeAuth,
  createFakeCompanies,
  FAKE_CODE,
  fakeUserId,
} from "./data/testing/fakeAuth";
import type { FakeAuthOptions } from "./data/testing/fakeAuth";
import { DataError } from "./data/types";
import type { DataErrorKind, Repository, StoredDeal } from "./data/types";
import type { HostedConfig } from "./config";
import { createOwnerMemory } from "./data/auth/rememberedOwner";
import { UNREACHABLE } from "./features/app/StartupScreens";
import { reportLostSave } from "./features/deal/lostSaves";
import { HostedGate, HostedRoot } from "./HostedRoot";
import { seedSampleDeal } from "./testing/renderApp";

const ANA: AuthUser = {
  id: fakeUserId("ana@example.com"),
  email: "ana@example.com",
};
const BEN: AuthUser = {
  id: fakeUserId("ben@example.com"),
  email: "ben@example.com",
};
const ANA_CO: Company = {
  id: "company-ana",
  name: "Ana Homes",
  defaultRegion: "utah-north",
};
const BEN_CO: Company = {
  id: "company-ben",
  name: "Ben Builds",
  defaultRegion: "utah-north",
};

const LAST_USER = "spec-studio:last-user";
const outboxKey = (user: AuthUser) => `spec-studio:outbox:${user.id}`;

/** Whether the server can be reached, and if not, how a call to it fails. */
interface Network {
  down: DataErrorKind | null;
}

const FAILURE_COPY: Partial<Record<DataErrorKind, string>> = {
  offline: "Can't reach the server — check your connection.",
  signedOut: "You've been signed out.",
};

/** `server` as this device reaches it: while the network is down, every call fails the way the Supabase one would. */
function overNetwork(server: Repository, network: Network): Repository {
  const reached: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(server) as [
    string,
    (...args: unknown[]) => Promise<unknown>,
  ][]) {
    reached[name] = async (...args: unknown[]) => {
      if (network.down)
        throw new DataError(
          FAILURE_COPY[network.down] ?? "The server said no.",
          { kind: network.down },
        );
      return method(...args);
    };
  }
  return reached as unknown as Repository;
}

interface WorldOptions {
  /** Who this device's stored session belongs to, if anyone. */
  user?: AuthUser;
  /** The companies that already exist, by owner. */
  companies?: [AuthUser, Company][];
  auth?: FakeAuthOptions;
  persistent?: boolean;
}

/**
 * A device and a server: the fake sign-in and companies, this browser's storage (where the outbox lives), and each
 * company's data on the server (a local repository standing in for Supabase), reached over a network the test can cut.
 */
function createWorld(options: WorldOptions = {}) {
  const auth = createFakeAuth({ ...options.auth, user: options.user });
  const companies = createFakeCompanies(auth);
  for (const [owner, company] of options.companies ?? [])
    companies.companies.set(owner.id, company);
  const device = new MemoryStorage();
  const network: Network = { down: null };
  const servers = new Map<string, Repository>();
  const server = (companyId: string): Repository => {
    let data = servers.get(companyId);
    if (!data) {
      data = createLocalRepository(new MemoryStorage());
      servers.set(companyId, data);
    }
    return data;
  };
  const makeRemote = vi.fn((companyId: string) =>
    overNetwork(server(companyId), network),
  );
  const mount = () =>
    render(
      <StrictMode>
        <HostedGate
          auth={auth}
          companies={companies}
          makeRemote={makeRemote}
          storage={device}
          persistent={options.persistent ?? true}
        />
      </StrictMode>,
    );
  /** The deals waiting in `user`'s outbox on this device. */
  const outbox = (user: AuthUser): StoredDeal[] =>
    (
      JSON.parse(device.getItem(outboxKey(user)) ?? '{"entries":[]}') as {
        entries: { deal: StoredDeal }[];
      }
    ).entries.map((entry) => entry.deal);
  const stored = async (companyId: string, dealId: string) =>
    (await server(companyId).getDeal(dealId))?.name;
  return {
    auth,
    companies,
    device,
    network,
    server,
    makeRemote,
    mount,
    outbox,
    stored,
  };
}

type World = ReturnType<typeof createWorld>;

async function signIn(user: UserEvent, email: string) {
  await user.type(await screen.findByLabelText("Email"), email);
  await user.click(
    screen.getByRole("button", { name: "Email me a sign-in link" }),
  );
  await user.type(await screen.findByLabelText("6-digit code"), FAKE_CODE);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

const signInPage = () =>
  screen.findByRole("heading", { level: 1, name: "Sign in to Spec Studio" });
const dealsPage = () =>
  screen.findByRole("heading", { level: 1, name: "Deals" }, { timeout: 3000 });

async function rename(user: UserEvent, name: string) {
  const field = await screen.findByLabelText("Deal name", undefined, {
    timeout: 3000,
  });
  await user.clear(field);
  await user.type(field, name);
  await user.tab();
}

beforeEach(() => {
  window.history.replaceState(null, "", "/#/deals");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HostedGate", () => {
  it("loads, asks the owner to sign in, then to name the company, then opens the deals", async () => {
    const user = userEvent.setup();
    const world = createWorld();
    world.mount();
    expect(
      screen.getByText("Loading…").closest("[aria-busy='true']"),
    ).not.toBeNull();

    expect(await signInPage()).toBeVisible();
    await signIn(user, ANA.email);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Name your company",
      }),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Company name"), "Ana Homes");
    await user.click(screen.getByRole("button", { name: "Create company" }));

    expect(await dealsPage()).toBeVisible();
    const header = screen.getByRole("banner");
    expect(
      within(header).getByRole("button", { name: ANA.email }),
    ).toBeVisible();
    expect(within(header).queryByText(/Demo mode/)).not.toBeInTheDocument();
    // The app reads the new company's data, and nobody else's.
    expect(world.makeRemote).toHaveBeenCalled();
    expect(new Set(world.makeRemote.mock.calls.map(([id]) => id))).toEqual(
      new Set(["company-1"]),
    );
    expect(screen.getByText(/No deals yet/)).toBeVisible();
  });

  it("opens the deals straight away for an owner with a stored session and a company", async () => {
    const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
    await world
      .server(ANA_CO.id)
      .createDeal({ name: "Maple Street", inputs: sampleDealInputs() });
    world.mount();
    expect(
      await screen.findByText("Maple Street", undefined, { timeout: 3000 }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Sign in to Spec Studio" }),
    ).not.toBeInTheDocument();
  });

  it("says, beside the account, that nothing is kept when the browser blocks storage", async () => {
    const world = createWorld({
      user: ANA,
      companies: [[ANA, ANA_CO]],
      persistent: false,
    });
    world.mount();
    await dealsPage();
    const header = screen.getByRole("banner");
    expect(
      within(header).getByText(
        "Not saved on this device — this browser blocks storage",
      ),
    ).toBeVisible();
    expect(
      within(header).getByRole("button", { name: ANA.email }),
    ).toBeVisible();
  });

  describe("when the server can't be reached at startup", () => {
    it("says so when the company can't be loaded, and Try again tries again", async () => {
      const user = userEvent.setup();
      const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
      const read = vi.spyOn(world.companies, "myCompany").mockRejectedValueOnce(
        new DataError("Can't reach the server — check your connection.", {
          kind: "offline",
        }),
      );
      world.mount();

      expect(await screen.findByText(UNREACHABLE)).toBeVisible();
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(await dealsPage()).toBeVisible();
      expect(read).toHaveBeenCalledTimes(2);
    });

    it("keeps saying so while Try again still can't reach it", async () => {
      const user = userEvent.setup();
      const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
      const read = vi.spyOn(world.companies, "myCompany").mockRejectedValue(
        new DataError("Can't reach the server — check your connection.", {
          kind: "offline",
        }),
      );
      world.mount();
      await screen.findByText(UNREACHABLE);
      await user.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      expect(await screen.findByText(UNREACHABLE)).toBeVisible();
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    });

    it("says so when reading the session can't reach the server", async () => {
      const user = userEvent.setup();
      const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
      const read = vi
        .spyOn(world.auth, "currentUser")
        .mockRejectedValue(new AuthError("offline"));
      world.mount();

      expect(await screen.findByText(UNREACHABLE)).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "Sign in to Spec Studio" }),
      ).not.toBeInTheDocument();
      read.mockRestore();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(await dealsPage()).toBeVisible();
    });

    it("does not wait forever on a request that never answers: after 15 s it says so, and Try again can succeed", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
      const read = vi
        .spyOn(world.companies, "myCompany")
        .mockImplementationOnce(() => new Promise(() => {}));
      world.mount();
      await screen.findByText("Loading…");

      await act(() => vi.advanceTimersByTimeAsync(14_000));
      expect(screen.getByText("Loading…")).toBeVisible();
      expect(screen.queryByText(UNREACHABLE)).not.toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(screen.getByText(UNREACHABLE)).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(await dealsPage()).toBeVisible();
      expect(read).toHaveBeenCalledTimes(2);
    });

    it("says a sign-in that ended on the server is a sign-in to do again", async () => {
      const user = userEvent.setup();
      const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
      vi.spyOn(world.companies, "myCompany").mockRejectedValueOnce(
        new DataError("You've been signed out.", { kind: "signedOut" }),
      );
      world.mount();
      expect(
        await screen.findByText("You've been signed out. Sign in again."),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await signInPage()).toBeVisible();
    });

    it("shows any other failure in the owner's words, with Try again", async () => {
      const user = userEvent.setup();
      const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
      vi.spyOn(world.companies, "myCompany").mockRejectedValueOnce(
        new DataError(
          "Couldn't load your company — the server said no. Try again in a minute.",
          { kind: "failed" },
        ),
      );
      world.mount();
      expect(
        await screen.findByText(
          "Couldn't load your company — the server said no. Try again in a minute.",
        ),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(await dealsPage()).toBeVisible();
    });
  });

  describe("sign-in links", () => {
    it("finishes a link once, even under StrictMode, and opens the deals", async () => {
      window.history.replaceState(null, "", `/?code=${ANA.email}#/deals`);
      const world = createWorld({ companies: [[ANA, ANA_CO]] });
      const exchange = vi.spyOn(world.auth, "exchangeLinkCode");
      world.mount();
      expect(await dealsPage()).toBeVisible();
      expect(exchange).toHaveBeenCalledTimes(1);
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("#/deals");
    });

    it("says why a link failed on the sign-in page, the first time only", async () => {
      const user = userEvent.setup();
      window.history.replaceState(null, "", "/?code=spent#/deals");
      const world = createWorld({
        companies: [[ANA, ANA_CO]],
        auth: { fail: { exchangeLinkCode: new AuthError("otherBrowser") } },
      });
      world.mount();
      expect(
        await screen.findByText(/opened in a different browser/),
      ).toBeVisible();

      await user.type(screen.getByLabelText("Email"), ANA.email);
      await user.type(screen.getByLabelText("6-digit code"), FAKE_CODE);
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await dealsPage()).toBeVisible();

      await user.click(screen.getByRole("button", { name: ANA.email }));
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      expect(await signInPage()).toBeVisible();
      expect(
        screen.queryByText(/opened in a different browser/),
      ).not.toBeInTheDocument();
    });
  });

  it("when the session ends mid-edit, the edit lands in that owner's outbox and syncs when they sign back in", async () => {
    const user = userEvent.setup();
    const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
    const deal = await seedSampleDeal(world.server(ANA_CO.id));
    window.history.replaceState(null, "", `/#/deals/${deal.id}/lot`);
    world.mount();
    await rename(user, "Renamed on site");

    // Before the autosave's second is up, the session ends, and the server now refuses this device.
    world.network.down = "signedOut";
    await act(() => world.auth.signOut());
    expect(await signInPage()).toBeVisible();
    // The editor's last save on the way out went into Ana's outbox, and nowhere else.
    expect(world.outbox(ANA).map((d) => d.name)).toEqual(["Renamed on site"]);
    expect(await world.stored(ANA_CO.id, deal.id)).toBe(SAMPLE_DEAL_NAME);

    world.network.down = null;
    await signIn(user, ANA.email);
    await waitFor(async () =>
      expect(await world.stored(ANA_CO.id, deal.id)).toBe("Renamed on site"),
    );
    expect(world.device.getItem(outboxKey(ANA))).toBeNull();
    // Back on the deal she was editing.
    expect(
      await screen.findByLabelText("Deal name", undefined, { timeout: 3000 }),
    ).toHaveValue("Renamed on site");
  });

  it("the Sign in link of a signed-out save ends the stale session; signing in lands on #/deals and stays signed in", async () => {
    const user = userEvent.setup();
    const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
    const deal = await seedSampleDeal(world.server(ANA_CO.id));
    window.history.replaceState(null, "", `/#/deals/${deal.id}/lot`);
    world.mount();
    await screen.findByLabelText("Deal name", undefined, { timeout: 3000 });

    // The server no longer takes this session, though the device still holds it.
    world.network.down = "signedOut";
    await rename(user, "Renamed on site");
    await user.click(
      await screen.findByRole("link", { name: "Sign in" }, { timeout: 3000 }),
    );
    expect(await signInPage()).toBeVisible();

    world.network.down = null;
    await signIn(user, ANA.email);
    expect(await dealsPage()).toBeVisible();
    expect(window.location.hash).toBe("#/deals");
    // Nothing signs the owner out again: give any loop the time to show itself.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(
      screen.queryByRole("heading", { name: "Sign in to Spec Studio" }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: ANA.email,
      }),
    ).toBeVisible();
    await waitFor(async () =>
      expect(await world.stored(ANA_CO.id, deal.id)).toBe("Renamed on site"),
    );
  });

  it("another owner on this device sees none of the first one's deals or waiting edits, which sync when the first returns", async () => {
    const user = userEvent.setup();
    const world = createWorld({
      user: ANA,
      companies: [
        [ANA, ANA_CO],
        [BEN, BEN_CO],
      ],
    });
    const anaDeal = await seedSampleDeal(world.server(ANA_CO.id));
    await world
      .server(BEN_CO.id)
      .createDeal({ name: "Ben's corner lot", inputs: sampleDealInputs() });
    // An edit Ana made while offline, still waiting on this device.
    createOfflineRepository(
      world.server(ANA_CO.id),
      world.device,
      ANA.id,
    ).queue({ ...anaDeal, name: "Ana's renamed deal" });
    world.network.down = "offline";
    world.mount();
    expect(
      await screen.findByText("1 change waiting to sync", undefined, {
        timeout: 3000,
      }),
    ).toBeVisible();
    expect(await screen.findByText("Ana's renamed deal")).toBeVisible();

    // Ana signs out: the menu asks first, as an edit has not synced.
    await user.click(screen.getByRole("button", { name: ANA.email }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Sign out",
      }),
    );
    expect(await signInPage()).toBeVisible();

    world.network.down = null;
    // Ben's list is held on its way, so whatever his Deals page shows before it arrives can only come from a cache.
    let listArrives!: () => void;
    const listHeld = new Promise<void>((resolve) => (listArrives = resolve));
    const benServer = world.server(BEN_CO.id);
    const list = benServer.listDeals.bind(benServer);
    vi.spyOn(benServer, "listDeals").mockImplementation(async () => {
      await listHeld;
      return list();
    });
    await signIn(user, BEN.email);
    const header = await screen.findByRole("banner", undefined, {
      timeout: 3000,
    });
    await screen.findByRole("heading", { level: 1, name: "Deals" });
    // Nothing of Ana's, from a cache or from her outbox.
    expect(screen.queryByText("Ana's renamed deal")).not.toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_DEAL_NAME)).not.toBeInTheDocument();
    expect(within(header).getByRole("status")).toBeEmptyDOMElement();
    listArrives();
    expect(await screen.findByText("Ben's corner lot")).toBeVisible();
    expect(screen.queryByText("Ana's renamed deal")).not.toBeInTheDocument();
    expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument();
    // Ana's edit is still hers, on this device, and Ben's session did not send it.
    expect(world.outbox(ANA).map((d) => d.name)).toEqual([
      "Ana's renamed deal",
    ]);
    expect(world.device.getItem(outboxKey(BEN))).toBeNull();
    expect(await world.stored(ANA_CO.id, anaDeal.id)).toBe(SAMPLE_DEAL_NAME);

    // Ben signs out and Ana signs back in: her edit syncs.
    await user.click(within(header).getByRole("button", { name: BEN.email }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await signIn(user, ANA.email);
    await waitFor(async () =>
      expect(await world.stored(ANA_CO.id, anaDeal.id)).toBe(
        "Ana's renamed deal",
      ),
    );
    expect(world.device.getItem(outboxKey(ANA))).toBeNull();
    await waitFor(() =>
      expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument(),
    );
  });

  it("once an owner's session ends, a sync run still going sends nothing more of theirs", async () => {
    const user = userEvent.setup();
    const world = createWorld({
      user: ANA,
      companies: [
        [ANA, ANA_CO],
        [BEN, BEN_CO],
      ],
    });
    const anaServer = world.server(ANA_CO.id);
    const first = await anaServer.createDeal({
      name: "First lot",
      inputs: sampleDealInputs(),
    });
    const second = await anaServer.createDeal({
      name: "Second lot",
      inputs: sampleDealInputs(),
    });
    const outbox = createOfflineRepository(anaServer, world.device, ANA.id);
    outbox.queue({ ...first, name: "First lot, renamed" });
    outbox.queue({ ...second, name: "Second lot, renamed" });
    // The first replay is slow to land; the session ends while it is out.
    let land!: () => void;
    const landed = new Promise<void>((resolve) => (land = resolve));
    const save = anaServer.saveDeal.bind(anaServer);
    const saves = vi
      .spyOn(anaServer, "saveDeal")
      .mockImplementationOnce(async (deal, options) => {
        await landed;
        return save(deal, options);
      });
    world.mount();
    await waitFor(() => expect(saves).toHaveBeenCalledTimes(1));

    await act(() => world.auth.signOut());
    expect(await signInPage()).toBeVisible();
    await act(async () => land());
    // The first one was already on its way; the second waits for Ana, unharmed, rather than go out under no session.
    await waitFor(() =>
      expect(world.outbox(ANA).map((d) => d.name)).toEqual([
        "Second lot, renamed",
      ]),
    );
    expect(saves).toHaveBeenCalledTimes(1);
    expect(
      (
        JSON.parse(world.device.getItem(outboxKey(ANA)) ?? "{}") as {
          entries: { problem?: string }[];
        }
      ).entries[0]?.problem,
    ).toBeUndefined();

    await signIn(user, ANA.email);
    await waitFor(async () =>
      expect(await world.stored(ANA_CO.id, second.id)).toBe(
        "Second lot, renamed",
      ),
    );
    expect(await world.stored(ANA_CO.id, first.id)).toBe("First lot, renamed");
  });

  it("does not show one owner's lost-save notice to the next", async () => {
    const user = userEvent.setup();
    const world = createWorld({
      user: ANA,
      companies: [
        [ANA, ANA_CO],
        [BEN, BEN_CO],
      ],
    });
    world.mount();
    await dealsPage();
    act(() =>
      reportLostSave({
        dealId: "d1",
        dealName: "Ana's lost deal",
        message: "the server said no",
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Ana's lost deal");

    await user.click(screen.getByRole("button", { name: ANA.email }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await signIn(user, BEN.email);
    expect(await dealsPage()).toBeVisible();
    expect(screen.queryByText(/Ana's lost deal/)).not.toBeInTheDocument();
  });
});

describe("HostedGate on a device that remembers its owner", () => {
  const offlineError = () =>
    new DataError("Can't reach the server — check your connection.", {
      kind: "offline",
    });
  const NOTICE =
    "Showing what's saved on this device — can't reach the server.";

  /** The page reloads with nothing reaching the server: the session read, the company and every data call fail offline. */
  function goOffline(world: World) {
    world.network.down = "offline";
    vi.spyOn(world.auth, "currentUser").mockRejectedValue(
      new AuthError("offline"),
    );
    vi.spyOn(world.companies, "myCompany").mockRejectedValue(offlineError());
  }

  it("reopens from the device when a returning owner reloads offline, and the waiting edit syncs once back online (Review Focus 3)", async () => {
    const user = userEvent.setup();
    const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
    const deal = await seedSampleDeal(world.server(ANA_CO.id));
    window.history.replaceState(null, "", `/#/deals/${deal.id}/lot`);
    const before = world.mount();
    await screen.findByLabelText("Deal name", undefined, { timeout: 3000 });
    // What the deal works out to with the server's comps, cost book and settings.
    const figures = screen.getByRole("region", {
      name: "Deal summary",
    }).textContent;
    world.network.down = "offline";
    await rename(user, "Renamed on site");
    expect(
      await screen.findByText(
        "Offline — saved on this device, will sync",
        undefined,
        { timeout: 3000 },
      ),
    ).toBeVisible();
    expect(world.outbox(ANA).map((d) => d.name)).toEqual(["Renamed on site"]);
    before.unmount();

    // The page is reloaded on the job site.
    goOffline(world);
    window.history.replaceState(null, "", "/#/deals");
    world.mount();
    expect(
      await screen.findByText("Renamed on site", undefined, { timeout: 3000 }),
    ).toBeVisible();
    expect(screen.getByText(NOTICE)).toBeVisible();
    expect(screen.getByText("1 change waiting to sync")).toBeVisible();
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: ANA.email,
      }),
    ).toBeVisible();
    expect(screen.queryByText(UNREACHABLE)).not.toBeInTheDocument();

    // The deal opens from the outbox copy, and works out the same from the copies of its comps, cost book and settings.
    await user.click(screen.getByRole("link", { name: "Renamed on site" }));
    expect(
      await screen.findByLabelText("Deal name", undefined, { timeout: 3000 }),
    ).toHaveValue("Renamed on site");
    expect(
      screen.getByRole("region", { name: "Deal summary" }).textContent,
    ).toBe(figures);
    expect(
      screen.getByRole("heading", { level: 1, name: "Lot" }),
    ).toBeVisible();

    // Back online: the browser says so, and the edit syncs.
    world.network.down = null;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(async () =>
      expect(await world.stored(ANA_CO.id, deal.id)).toBe("Renamed on site"),
    );
    await waitFor(() =>
      expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument(),
    );
    expect(world.device.getItem(outboxKey(ANA))).toBeNull();
  });

  /** The keys of `user`'s copy of reads on this device. */
  const copyKeys = (world: World, user: AuthUser) =>
    Array.from(
      { length: world.device.length },
      (_, i) => world.device.key(i) ?? "",
    ).filter((key) => key.startsWith(`spec-studio:cache:${user.id}:`));

  async function twoOwners() {
    const world = createWorld({
      user: ANA,
      companies: [
        [ANA, ANA_CO],
        [BEN, BEN_CO],
      ],
    });
    await world
      .server(ANA_CO.id)
      .createDeal({ name: "Maple Street", inputs: sampleDealInputs() });
    await world
      .server(BEN_CO.id)
      .createDeal({ name: "Ben's corner lot", inputs: sampleDealInputs() });
    return world;
  }

  /** Ben signs in, sees his list, and the page is reloaded offline. */
  async function benReloadsOffline(world: World, user: UserEvent) {
    await signIn(user, BEN.email);
    expect(
      await screen.findByText("Ben's corner lot", undefined, { timeout: 3000 }),
    ).toBeVisible();
    cleanup();
    goOffline(world);
    world.mount();
    expect(
      await screen.findByText("Ben's corner lot", undefined, { timeout: 3000 }),
    ).toBeVisible();
    expect(screen.getByText(NOTICE)).toBeVisible();
    expect(screen.queryByText("Maple Street")).not.toBeInTheDocument();
  }

  it("clears an owner's copy on an explicit sign-out, keeping their outbox, and the next owner never sees it", async () => {
    const user = userEvent.setup();
    const world = await twoOwners();
    // An edit of Ana's that the server keeps refusing, so it is still waiting when she signs out.
    const maple = (await world.server(ANA_CO.id).listDeals()).deals[0]!;
    createOfflineRepository(
      world.server(ANA_CO.id),
      world.device,
      ANA.id,
    ).queue({ ...maple, name: "Maple Street, edited" });
    vi.spyOn(world.server(ANA_CO.id), "saveDeal").mockRejectedValue(
      offlineError(),
    );
    world.mount();
    expect(
      await screen.findByText("Maple Street, edited", undefined, {
        timeout: 3000,
      }),
    ).toBeVisible();
    expect(copyKeys(world, ANA).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: ANA.email }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Sign out",
      }),
    );
    expect(await signInPage()).toBeVisible();
    expect(copyKeys(world, ANA)).toEqual([]);
    expect(world.outbox(ANA).map((d) => d.name)).toEqual([
      "Maple Street, edited",
    ]);

    await benReloadsOffline(world, user);
  });

  it("keeps the copy when the server ends the session, and still serves each owner only their own", async () => {
    const user = userEvent.setup();
    const world = await twoOwners();
    world.mount();
    expect(
      await screen.findByText("Maple Street", undefined, { timeout: 3000 }),
    ).toBeVisible();
    const anaKeys = copyKeys(world, ANA);

    await act(() => world.auth.signOut());
    expect(await signInPage()).toBeVisible();
    expect(copyKeys(world, ANA)).toEqual(anaKeys);

    await benReloadsOffline(world, user);
    expect(copyKeys(world, ANA)).toEqual(anaKeys);
  });

  it("still says it can't reach the server for a remembered owner whose company was never loaded here", async () => {
    const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
    createOwnerMemory(world.device).rememberOwner(ANA);
    goOffline(world);
    world.mount();
    expect(await screen.findByText(UNREACHABLE)).toBeVisible();
  });

  it("forgets the owner on an explicit sign-out: a reload, offline or not, shows the sign-in page and never their data", async () => {
    const user = userEvent.setup();
    const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
    await world
      .server(ANA_CO.id)
      .createDeal({ name: "Maple Street", inputs: sampleDealInputs() });
    const first = world.mount();
    expect(
      await screen.findByText("Maple Street", undefined, { timeout: 3000 }),
    ).toBeVisible();
    expect(JSON.parse(world.device.getItem(LAST_USER) ?? "null")).toEqual(ANA);

    await user.click(screen.getByRole("button", { name: ANA.email }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await signInPage()).toBeVisible();
    expect(world.device.getItem(LAST_USER)).toBeNull();
    first.unmount();

    // A reload, online.
    const online = world.mount();
    expect(await signInPage()).toBeVisible();
    online.unmount();

    // A reload, offline: no session is stored, so there is no one to open as.
    world.network.down = "offline";
    vi.spyOn(world.companies, "myCompany").mockRejectedValue(offlineError());
    const offline = world.mount();
    expect(await signInPage()).toBeVisible();
    offline.unmount();

    // Even a session the device still held but could not read offline does not open as Ana.
    vi.spyOn(world.auth, "currentUser").mockRejectedValue(
      new AuthError("offline"),
    );
    world.mount();
    expect(await screen.findByText(UNREACHABLE)).toBeVisible();
    expect(screen.queryByText("Maple Street")).not.toBeInTheDocument();
  });

  it("when the session can't be renewed after reconnecting, shows the sign-in page and keeps the owner's outbox", async () => {
    const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
    const deal = await world
      .server(ANA_CO.id)
      .createDeal({ name: "Maple Street", inputs: sampleDealInputs() });
    const memory = createOwnerMemory(world.device);
    memory.rememberOwner(ANA);
    memory.rememberCompany(ANA.id, ANA_CO);
    createOfflineRepository(
      world.server(ANA_CO.id),
      world.device,
      ANA.id,
    ).queue({ ...deal, name: "Oak Hollow" });
    goOffline(world);
    world.mount();
    expect(
      await screen.findByText("1 change waiting to sync", undefined, {
        timeout: 3000,
      }),
    ).toBeVisible();

    // The network is back, but the server no longer takes the session, and supabase-js drops it.
    world.network.down = "signedOut";
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await act(() => world.auth.signOut());
    expect(await signInPage()).toBeVisible();
    expect(world.outbox(ANA).map((d) => d.name)).toEqual(["Oak Hollow"]);
    expect(world.device.getItem(LAST_USER)).toBeNull();
    expect(await world.stored(ANA_CO.id, deal.id)).toBe("Maple Street");
  });
});

describe("HostedGate signing out", () => {
  it("when supabase-js drops the session and then says it couldn't reach the server: the sign-in page, the outbox kept, reported once", async () => {
    const user = userEvent.setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
    const deal = await world
      .server(ANA_CO.id)
      .createDeal({ name: "Maple Street", inputs: sampleDealInputs() });
    createOfflineRepository(
      world.server(ANA_CO.id),
      world.device,
      ANA.id,
    ).queue({ ...deal, name: "Oak Hollow" });
    // Only the save is refused, so the edit keeps waiting while the rest of the app loads.
    vi.spyOn(world.server(ANA_CO.id), "saveDeal").mockRejectedValue(
      new DataError("Can't reach the server — check your connection.", {
        kind: "offline",
      }),
    );
    const signOut = world.auth.signOut.bind(world.auth);
    vi.spyOn(world.auth, "signOut").mockImplementation(async () => {
      await signOut();
      throw new AuthError("offline");
    });
    world.mount();
    await screen.findByText("1 change waiting to sync", undefined, {
      timeout: 3000,
    });

    await user.click(screen.getByRole("button", { name: ANA.email }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Sign out",
      }),
    );
    expect(await signInPage()).toBeVisible();
    await waitFor(() => expect(logged).toHaveBeenCalledTimes(1));
    expect(String(logged.mock.calls[0]?.[0])).toMatch(/Couldn't sign out/);
    expect(world.outbox(ANA).map((d) => d.name)).toEqual(["Oak Hollow"]);
  });

  it("says so on the page when signing out fails and the session stays", async () => {
    const user = userEvent.setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const world = createWorld({
      user: ANA,
      companies: [[ANA, ANA_CO]],
      auth: { fail: { signOut: new AuthError("offline") } },
    });
    world.mount();
    await dealsPage();
    await user.click(screen.getByRole("button", { name: ANA.email }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    const alert = (
      await screen.findByText(
        "Couldn't sign out — check your connection, then try again.",
      )
    ).closest("[role='alert']");
    expect(alert).not.toBeNull();
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: ANA.email,
      }),
    ).toBeVisible();
    expect(logged).toHaveBeenCalledTimes(1);
    await user.click(
      within(alert as HTMLElement).getByRole("button", { name: "Dismiss" }),
    );
    expect(screen.queryByText(/Couldn't sign out/)).not.toBeInTheDocument();
  });

  it("a sign-out and the same owner's sign-in that land in one render still leave a working connection", async () => {
    const user = userEvent.setup();
    const world = createWorld({ user: ANA, companies: [[ANA, ANA_CO]] });
    const deal = await seedSampleDeal(world.server(ANA_CO.id));
    window.history.replaceState(null, "", `/#/deals/${deal.id}/lot`);
    world.mount();
    await screen.findByLabelText("Deal name", undefined, { timeout: 3000 });

    // Both changes are heard before React renders again, so the gate sees Ana throughout.
    act(() => {
      void world.auth.signOut();
      void world.auth.verifyCode(ANA.email, FAKE_CODE);
    });
    await rename(user, "Renamed after");
    await waitFor(
      async () =>
        expect(await world.stored(ANA_CO.id, deal.id)).toBe("Renamed after"),
      { timeout: 3000 },
    );
  });

  it("a different owner signing in starts on the deals, not where the last owner was", async () => {
    const user = userEvent.setup();
    const world = createWorld({
      user: ANA,
      companies: [
        [ANA, ANA_CO],
        [BEN, BEN_CO],
      ],
    });
    const deal = await seedSampleDeal(world.server(ANA_CO.id));
    window.history.replaceState(null, "", `/#/deals/${deal.id}/lot`);
    world.mount();
    await screen.findByLabelText("Deal name", undefined, { timeout: 3000 });

    await user.click(screen.getByRole("button", { name: ANA.email }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await signIn(user, BEN.email);
    expect(await dealsPage()).toBeVisible();
    expect(window.location.hash).toBe("#/deals");
  });
});

describe("HostedRoot", () => {
  const SESSION = {
    access_token: "a.b.c",
    refresh_token: "r",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: ANA.id,
      email: ANA.email,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-10-30T00:00:00Z",
    },
  };
  const COMPANY_ID = "c0ffee00-0000-4000-8000-000000000001";
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  /** Supabase as far as signing in by code and listing one company's deals goes. */
  function fakeSupabase() {
    const requests: string[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      requests.push(
        `${request.method} ${url.pathname}${decodeURIComponent(url.search)}`,
      );
      if (url.pathname === "/auth/v1/otp") return json({});
      if (url.pathname === "/auth/v1/verify") return json(SESSION);
      if (url.pathname === "/rest/v1/memberships") {
        return json([
          {
            company_id: COMPANY_ID,
            companies: {
              id: COMPANY_ID,
              name: "Ana Homes",
              default_region: "utah-north",
            },
          },
        ]);
      }
      return json([]);
    };
    return { requests, fakeFetch };
  }

  it("wires the real client: no request until sign-in, then the company and its deals, with one client under StrictMode", async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, "warn");
    const { requests, fakeFetch } = fakeSupabase();
    render(
      <StrictMode>
        <HostedRoot
          config={{
            mode: "hosted",
            supabaseUrl: "http://hosted-root-smoke.test",
            supabaseAnonKey: "anon-key",
          }}
          storage={new MemoryStorage()}
          persistent
          fetchOverride={fakeFetch}
        />
      </StrictMode>,
    );
    expect(await signInPage()).toBeVisible();
    expect(requests).toEqual([]);

    await signIn(user, ANA.email);
    expect(await dealsPage()).toBeVisible();
    expect(requests).toContain("POST /auth/v1/verify");
    expect(requests.some((r) => r.startsWith("GET /rest/v1/memberships"))).toBe(
      true,
    );
    await waitFor(() =>
      expect(
        requests.some(
          (r) =>
            r.startsWith("GET /rest/v1/deals") &&
            r.includes(`company_id=eq.${COMPANY_ID}`),
        ),
      ).toBe(true),
    );
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(
      /Multiple GoTrueClient/,
    );
  });

  it("makes one client per config and storage: the same config over another browser's storage starts signed out", async () => {
    const user = userEvent.setup();
    // Two clients on one address is what this test makes, and supabase-js warns of it.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fakeFetch } = fakeSupabase();
    const config: HostedConfig = {
      mode: "hosted",
      supabaseUrl: "http://two-storages.test",
      supabaseAnonKey: "anon-key",
    };
    const first = render(
      <HostedRoot
        config={config}
        storage={new MemoryStorage()}
        persistent
        fetchOverride={fakeFetch}
      />,
    );
    await signIn(user, ANA.email);
    expect(await dealsPage()).toBeVisible();
    first.unmount();

    render(
      <HostedRoot
        config={config}
        storage={new MemoryStorage()}
        persistent
        fetchOverride={fakeFetch}
      />,
    );
    expect(await signInPage()).toBeVisible();
  });
});
