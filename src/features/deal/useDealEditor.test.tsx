import { testSampleComps } from "../../testing/sampleIds";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DealInputs } from "@engine";
import { createLocalRepository, DEALS_KEY } from "../../data/local/localRepository";
import { createQueryClient } from "../../data/queryClient";
import { queryKeys } from "../../data/queries";
import { RepositoryProvider } from "../../data/RepositoryProvider";
import { SAMPLE_DEAL_NAME, sampleDealInputs } from "../../data/sample";
import { MemoryStorage } from "../../data/local/memoryStorage";
import { createOfflineRepository } from "../../data/offline/offlineRepository";
import type { OfflineRepository } from "../../data/offline/offlineRepository";
import { DataError } from "../../data/types";
import type { Repository, StoredDeal } from "../../data/types";
import { resetLostSaves, useLostSaves } from "./lostSaves";
import { useDealEditor } from "./useDealEditor";

const ORIGINAL_PRICE = sampleDealInputs().lot.priceCents;
const NEW_PRICE = 25_400_000;
const setPrice = (cents: number) => (draft: DealInputs) => {
  draft.lot.priceCents = cents;
};

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

interface Setup {
  storage: MemoryStorage;
  /** The repository the hook sees: the local one, with `saveDeal` wrapped in a spy. */
  repository: Repository;
  saveDeal: ReturnType<typeof vi.fn<Repository["saveDeal"]>>;
  client: QueryClient;
  /** The deal stored before the hook runs. */
  first: StoredDeal;
  storedDeal(id: string): Promise<StoredDeal | null>;
  render(id?: string, options?: { strict?: boolean }): ReturnType<typeof renderEditor>;
}

async function setup(overrides: Partial<Repository> = {}, wrap: (repository: Repository) => Repository = (r) => r): Promise<Setup> {
  const storage = new MemoryStorage();
  let n = 0;
  const base = createLocalRepository(storage, { newId: () => `deal-${++n}` });
  for (const comp of testSampleComps()) await base.saveComp(comp);
  const first = await base.createDeal({ name: SAMPLE_DEAL_NAME, inputs: sampleDealInputs() });
  const saveDeal = vi.fn<Repository["saveDeal"]>((deal, options) => base.saveDeal(deal, options));
  const repository: Repository = wrap({ ...base, saveDeal, ...overrides });
  const client = createQueryClient();
  const wrapperFor = (strict: boolean) =>
    function Wrapper({ children }: { children: ReactNode }) {
      const tree = (
        <QueryClientProvider client={client}>
          <RepositoryProvider repository={repository}>{children}</RepositoryProvider>
        </QueryClientProvider>
      );
      return strict ? <StrictMode>{tree}</StrictMode> : tree;
    };
  return {
    storage,
    repository,
    saveDeal,
    client,
    first,
    storedDeal: (id) => base.getDeal(id),
    render: (id = first.id, options = {}) => renderEditor(id, wrapperFor(options.strict === true)),
  };
}

function renderEditor(id: string, wrapper: (props: { children: ReactNode }) => ReactNode) {
  return renderHook(({ dealId }: { dealId: string }) => useDealEditor(dealId), { initialProps: { dealId: id }, wrapper });
}

type View = ReturnType<typeof renderEditor>;

/** Lets the reads finish (fake time moves a little each round) until `until` holds. */
async function settle(view: View, until: (editor: View["result"]["current"]) => boolean = (e) => e.status !== "loading") {
  for (let i = 0; i < 40 && !until(view.result.current); i++) await advance(10);
  expect(until(view.result.current)).toBe(true);
}

const ready = async (s: Setup, id?: string, options?: { strict?: boolean }) => {
  const view = s.render(id, options);
  await settle(view);
  return view;
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetLostSaves();
});

describe("useDealEditor loading", () => {
  it("is loading first, then ready with the deal, an evaluation and its context", async () => {
    const s = await setup();
    const view = s.render();
    expect(view.result.current.status).toBe("loading");
    expect(view.result.current.inputs).toBeUndefined();
    expect(view.result.current.evaluation).toBeUndefined();

    await settle(view);
    const editor = view.result.current;
    expect(editor.status).toBe("ready");
    expect(editor.error).toBeUndefined();
    expect(editor.deal?.id).toBe(s.first.id);
    expect(editor.deal?.name).toBe(SAMPLE_DEAL_NAME);
    expect(editor.inputs).toEqual(sampleDealInputs());
    expect(editor.deal?.inputs).toBe(editor.inputs);
    expect(editor.context?.comps).toHaveLength(testSampleComps().length);
    expect(editor.evaluation?.verdict).toBeDefined();
    expect(editor.evaluation?.scenarios.status).toBe("ok");
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(editor.saveStatus).toEqual({ kind: "saved" });
  });

  it("is notFound for an id nobody stored", async () => {
    const s = await setup();
    const view = await ready(s, "no-such-deal");
    expect(view.result.current.status).toBe("notFound");
    expect(view.result.current.inputs).toBeUndefined();
    expect(view.result.current.evaluation).toBeUndefined();
  });

  it("is an error, with the record id, for a stored deal that cannot be read", async () => {
    const s = await setup();
    const good = (await s.storedDeal(s.first.id)) as StoredDeal;
    const broken = { ...good, id: "bad-1", inputs: { ...good.inputs, lot: { ...good.inputs.lot, priceCents: "x" } } };
    s.storage.setItem(DEALS_KEY, JSON.stringify({ [good.id]: good, "bad-1": broken }));

    const view = await ready(s, "bad-1");
    const editor = view.result.current;
    expect(editor.status).toBe("error");
    expect(editor.error).toBeInstanceOf(DataError);
    expect(editor.error?.recordId).toBe("bad-1");
    expect(editor.inputs).toBeUndefined();
  });

  it("is an error when the context cannot be loaded, and wraps a failure that is not a DataError", async () => {
    const network = new Error("network is down");
    const s = await setup({
      getCostBook: async () => {
        throw network;
      },
    });
    const view = await ready(s);
    const editor = view.result.current;
    expect(editor.status).toBe("error");
    expect(editor.error).toBeInstanceOf(DataError);
    expect(editor.error?.message).toBe("network is down");
    expect(editor.error?.cause).toBe(network);
    expect(editor.inputs).toBeUndefined();
  });

  it("passes a DataError from the context through as it is", async () => {
    const original = new DataError("cost book is unreadable", { recordId: "cb" });
    const s = await setup({
      getMarketSettings: async () => {
        throw original;
      },
    });
    const view = await ready(s);
    expect(view.result.current.status).toBe("error");
    expect(view.result.current.error).toBe(original);
  });

  it("is an error, not an endless spinner, for a deal with no region", async () => {
    const s = await setup();
    const noRegion = await s.repository.createDeal({
      name: "No region",
      inputs: (() => {
        const inputs = sampleDealInputs();
        inputs.lot.region = "";
        return inputs;
      })(),
    });
    const view = await ready(s, noRegion.id);
    expect(view.result.current.status).toBe("error");
    expect(view.result.current.error).toBeInstanceOf(DataError);
    expect(view.result.current.error?.recordId).toBe(noRegion.id);
    expect(view.result.current.error?.path).toBe("inputs.lot.region");
  });

  it("does not save anything just for loading", async () => {
    const s = await setup();
    const view = await ready(s);
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
  });
});

describe("useDealEditor editing", () => {
  it("shows an edit at once and re-evaluates 150 ms after it", async () => {
    const s = await setup();
    const view = await ready(s);
    const before = view.result.current.evaluation;
    expect(before).toBeDefined();

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    expect(view.result.current.inputs?.lot.priceCents).toBe(NEW_PRICE);
    expect(view.result.current.deal?.inputs.lot.priceCents).toBe(NEW_PRICE);
    expect(view.result.current.canUndo).toBe(true);
    expect(view.result.current.evaluation).toBe(before);

    await advance(149);
    expect(view.result.current.evaluation).toBe(before);
    await advance(1);
    const after = view.result.current.evaluation;
    expect(after).not.toBe(before);
    expect(after?.scenarios).not.toEqual(before?.scenarios);
  });

  it("gives the inputs the evaluation is of, which trail an edit by 150 ms", async () => {
    const s = await setup();
    const view = await ready(s);
    expect(view.result.current.evaluatedInputs).toBe(view.result.current.inputs);

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    expect(view.result.current.evaluatedInputs?.lot.priceCents).toBe(ORIGINAL_PRICE);
    await advance(150);
    expect(view.result.current.evaluatedInputs).toBe(view.result.current.inputs);
    expect(view.result.current.evaluatedInputs?.lot.priceCents).toBe(NEW_PRICE);
  });

  it("re-evaluates once for a burst of edits, 150 ms after the last", async () => {
    const s = await setup();
    const view = await ready(s);
    const before = view.result.current.evaluation;

    act(() => view.result.current.edit(setPrice(20_000_000)));
    await advance(100);
    act(() => view.result.current.edit(setPrice(21_000_000)));
    await advance(100);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(149);
    expect(view.result.current.evaluation).toBe(before);
    await advance(1);
    const after = view.result.current.evaluation;
    expect(after).not.toBe(before);
    expect(after?.scenarios).not.toEqual(before?.scenarios);
  });

  it("stores the edit in the repository 1,000 ms after it, and refreshes the cached deal", async () => {
    const s = await setup();
    const view = await ready(s);
    const idle = view.result.current.deal?.updatedAt;
    await s.client.prefetchQuery({ queryKey: queryKeys.deals, queryFn: () => s.repository.listDeals() });

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    expect(view.result.current.saveStatus).toEqual({ kind: "pending" });

    await advance(999);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(ORIGINAL_PRICE);
    expect(s.saveDeal).not.toHaveBeenCalled();
    await advance(1);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect(s.saveDeal.mock.calls[0]?.[0]).toMatchObject({ id: s.first.id, name: SAMPLE_DEAL_NAME });

    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    // The cache holds what the repository returned, so `updatedAt` moved on; and the list is marked out of date.
    const cached = s.client.getQueryData<StoredDeal>(queryKeys.deal(s.first.id));
    expect(cached?.inputs.lot.priceCents).toBe(NEW_PRICE);
    expect(view.result.current.deal?.updatedAt).toBe(cached?.updatedAt);
    expect(view.result.current.deal?.updatedAt).not.toBe(idle);
    expect(s.client.getQueryState(queryKeys.deals)?.isInvalidated).toBe(true);
  });

  it("saves once for a burst of edits, with the last one", async () => {
    const s = await setup();
    const view = await ready(s);
    for (const cents of [20_000_000, 21_000_000, NEW_PRICE]) {
      act(() => view.result.current.edit(setPrice(cents)));
      await advance(300);
    }
    await advance(700);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
  });

  it("undo restores the previous price, and redo brings the edit back", async () => {
    const s = await setup();
    const view = await ready(s);
    const original = view.result.current.evaluation;

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(150);
    expect(view.result.current.evaluation).not.toBe(original);

    act(() => view.result.current.undo());
    expect(view.result.current.inputs?.lot.priceCents).toBe(ORIGINAL_PRICE);
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.canRedo).toBe(true);
    await advance(150);
    expect(view.result.current.evaluation).toEqual(original);

    act(() => view.result.current.redo());
    expect(view.result.current.inputs?.lot.priceCents).toBe(NEW_PRICE);
    expect(view.result.current.canUndo).toBe(true);
    expect(view.result.current.canRedo).toBe(false);
  });

  it("saves an undo: the original price is stored after the first edit is undone", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);

    act(() => view.result.current.undo());
    expect(view.result.current.saveStatus).toEqual({ kind: "pending" });
    await advance(1000);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(ORIGINAL_PRICE);
    expect(s.saveDeal).toHaveBeenCalledTimes(2);
  });

  it("saves a redo", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    act(() => view.result.current.undo());
    await advance(1000);
    act(() => view.result.current.redo());
    await advance(1000);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
    expect(s.saveDeal).toHaveBeenCalledTimes(3);
  });

  it("treats an edit that changes nothing as no edit: no history, no save", async () => {
    const s = await setup();
    const view = await ready(s);
    const { inputs } = view.result.current;
    act(() => view.result.current.edit(setPrice(ORIGINAL_PRICE)));
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.inputs).toBe(inputs);
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
  });

  it("keeps an edit when the deal is read again, because the deal loads once per id", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));

    // A refetch that returns the stored (older) deal, before the autosave has run.
    await act(async () => {
      await s.client.invalidateQueries({ queryKey: queryKeys.deal(s.first.id) });
    });
    await advance(10);
    expect(view.result.current.inputs?.lot.priceCents).toBe(NEW_PRICE);
    expect(view.result.current.canUndo).toBe(true);

    await advance(1000);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
  });

  it("starts from the stored deal, not from an older copy left in the query cache", async () => {
    const s = await setup();
    // An earlier visit left the deal in the cache; the stored deal has moved on since (a save landed after leaving).
    const stale = (await s.storedDeal(s.first.id)) as StoredDeal;
    await s.repository.saveDeal({ ...stale, inputs: { ...stale.inputs, lot: { ...stale.inputs.lot, priceCents: NEW_PRICE } } });
    s.client.setQueryData(queryKeys.deal(s.first.id), stale);

    const view = await ready(s);
    expect(view.result.current.inputs?.lot.priceCents).toBe(NEW_PRICE);
    expect(view.result.current.canUndo).toBe(false);
  });

  it("stays ready when a later read of the deal fails", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));

    vi.spyOn(s.repository, "getDeal").mockRejectedValueOnce(new DataError("storage went away", { recordId: s.first.id }));
    await act(async () => {
      await s.client.invalidateQueries({ queryKey: queryKeys.deal(s.first.id) });
    });
    await advance(10);
    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.error).toBeUndefined();
    expect(view.result.current.inputs?.lot.priceCents).toBe(NEW_PRICE);
  });

  it("is an error, not the old copy, when the cache has the deal but reading it again fails", async () => {
    const s = await setup();
    s.client.setQueryData(queryKeys.deal(s.first.id), s.first);
    vi.spyOn(s.repository, "getDeal").mockRejectedValueOnce(new DataError("unreadable now", { recordId: s.first.id }));

    const view = await ready(s);
    expect(view.result.current.status).toBe("error");
    expect(view.result.current.error?.message).toBe("unreadable now");
    expect(view.result.current.inputs).toBeUndefined();
  });

  it("gives edit, undo, redo and rename a stable identity", async () => {
    const s = await setup();
    const view = await ready(s);
    const { edit, undo, redo, rename, discardChanges } = view.result.current;
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(view.result.current.edit).toBe(edit);
    expect(view.result.current.undo).toBe(undo);
    expect(view.result.current.redo).toBe(redo);
    expect(view.result.current.rename).toBe(rename);
    expect(view.result.current.discardChanges).toBe(discardChanges);
  });

  it("is notFound, with nothing written back, when the deal turns out to be deleted while it is open", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    expect(view.result.current.saveStatus).toEqual({ kind: "pending" });

    // Deleted elsewhere: the repository forgets it, and the next read of it comes back empty.
    await s.repository.deleteDeal(s.first.id);
    await act(async () => {
      await s.client.invalidateQueries({ queryKey: queryKeys.deal(s.first.id) });
    });
    await advance(10);
    expect(view.result.current.status).toBe("notFound");
    expect(view.result.current.deal).toBeUndefined();
    expect(view.result.current.inputs).toBeUndefined();
    expect(view.result.current.canUndo).toBe(false);
    let accepted: boolean | undefined;
    act(() => {
      accepted = view.result.current.rename("Too late");
    });
    expect(accepted).toBe(false);

    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
    expect(await s.storedDeal(s.first.id)).toBeNull();
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });

    view.unmount();
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
    expect(await s.storedDeal(s.first.id)).toBeNull();
  });

  it("is notFound when the cached deal is set to null under an editor with a save waiting", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));

    act(() => {
      s.client.setQueryData(queryKeys.deal(s.first.id), null);
    });
    await advance(0); // the query client tells its observers on the next tick
    expect(view.result.current.status).toBe("notFound");
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(ORIGINAL_PRICE);
  });
});

describe("useDealEditor discardChanges", () => {
  it("cancels the save that is waiting", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    expect(view.result.current.saveStatus).toEqual({ kind: "pending" });

    act(() => view.result.current.discardChanges());
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    await advance(5000);
    expect(s.saveDeal).not.toHaveBeenCalled();
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(ORIGINAL_PRICE);
    // The editor itself is untouched: only the saving was given up.
    expect(view.result.current.inputs?.lot.priceCents).toBe(NEW_PRICE);
  });

  it("leaves nothing for the editor to save when it goes away", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    act(() => view.result.current.rename("Doomed"));
    act(() => view.result.current.discardChanges());

    view.unmount();
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
    const stored = await s.storedDeal(s.first.id);
    expect(stored?.inputs.lot.priceCents).toBe(ORIGINAL_PRICE);
    expect(stored?.name).toBe(SAMPLE_DEAL_NAME);
  });

  it("leaves nothing for pagehide to save", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    act(() => view.result.current.rename("Doomed"));
    act(() => view.result.current.discardChanges());

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
    expect((await s.storedDeal(s.first.id))?.name).toBe(SAMPLE_DEAL_NAME);
  });

  it("can be called again and again, and edits after it are saved as usual", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.discardChanges());
    act(() => view.result.current.discardChanges());
    act(() => view.result.current.edit(setPrice(20_000_000)));
    act(() => view.result.current.discardChanges());
    act(() => view.result.current.discardChanges());
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
  });
});

describe("useDealEditor edits that could not be saved", () => {
  it("records the lost edits, and says so on the console, when the last save fails as the editor goes away", async () => {
    const s = await setup();
    s.saveDeal.mockRejectedValueOnce(new Error("Couldn't save — browser storage is full or unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const lost = renderHook(() => useLostSaves());
    const view = await ready(s);

    act(() => {
      view.result.current.rename("Renamed before leaving");
      view.result.current.edit(setPrice(NEW_PRICE));
    });
    view.unmount();
    await advance(60_000);

    expect(s.saveDeal).toHaveBeenCalledTimes(1); // nothing retries a deal nobody is looking at
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(ORIGINAL_PRICE);
    expect(lost.result.current).toEqual([
      {
        dealId: s.first.id,
        dealName: "Renamed before leaving",
        message: "Couldn't save — browser storage is full or unavailable",
      },
    ]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      `Couldn't save deal ${s.first.id}:`,
      "Couldn't save — browser storage is full or unavailable",
    );
    consoleError.mockRestore();
  });

  it("records the old deal's lost edits when the editor moves to another deal", async () => {
    const s = await setup();
    const second = await s.repository.createDeal({ name: "Second deal", inputs: sampleDealInputs() });
    s.saveDeal.mockRejectedValueOnce(new Error("disk full"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const lost = renderHook(() => useLostSaves());
    const view = await ready(s);

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    view.rerender({ dealId: second.id });
    await settle(view);
    await advance(10);

    expect(lost.result.current).toEqual([{ dealId: s.first.id, dealName: SAMPLE_DEAL_NAME, message: "disk full" }]);
    expect(consoleError).toHaveBeenCalledWith(`Couldn't save deal ${s.first.id}:`, "disk full");
    // The new deal is its own story: it is loaded and has nothing wrong with it.
    expect(view.result.current.deal?.id).toBe(second.id);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    consoleError.mockRestore();
  });

  it("records nothing when the last save works", async () => {
    const s = await setup();
    const consoleError = vi.spyOn(console, "error");
    const lost = renderHook(() => useLostSaves());
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    view.unmount();
    await advance(60_000);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
    expect(lost.result.current).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("records nothing for a failed save that is still being retried", async () => {
    const s = await setup();
    s.saveDeal.mockRejectedValueOnce(new Error("down"));
    const consoleError = vi.spyOn(console, "error");
    const lost = renderHook(() => useLostSaves());
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(view.result.current.saveStatus.kind).toBe("error");
    expect(lost.result.current).toEqual([]);
    await advance(5000);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    expect(lost.result.current).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("useDealEditor rename", () => {
  it("trims the name, shows it at once and saves it 1,000 ms later", async () => {
    const s = await setup();
    const view = await ready(s);
    let accepted: boolean | undefined;
    act(() => {
      accepted = view.result.current.rename("  Lot 7 on Main  ");
    });
    expect(accepted).toBe(true);
    expect(view.result.current.deal?.name).toBe("Lot 7 on Main");
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.saveStatus).toEqual({ kind: "pending" });

    await advance(1000);
    const stored = await s.storedDeal(s.first.id);
    expect(stored?.name).toBe("Lot 7 on Main");
    expect(stored?.inputs).toEqual(sampleDealInputs());
  });

  it("refuses a blank name: false, nothing changes, nothing is saved", async () => {
    const s = await setup();
    const view = await ready(s);
    let accepted: boolean | undefined;
    act(() => {
      accepted = view.result.current.rename("   ");
    });
    expect(accepted).toBe(false);
    expect(view.result.current.deal?.name).toBe(SAMPLE_DEAL_NAME);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
  });

  it("does not save when the name is the same", async () => {
    const s = await setup();
    const view = await ready(s);
    let accepted: boolean | undefined;
    act(() => {
      accepted = view.result.current.rename(` ${SAMPLE_DEAL_NAME} `);
    });
    expect(accepted).toBe(true);
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
  });

  it("saves a rename and an edit made together as one deal", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => {
      view.result.current.rename("Renamed");
      view.result.current.edit(setPrice(NEW_PRICE));
    });
    await advance(1000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    const stored = await s.storedDeal(s.first.id);
    expect(stored?.name).toBe("Renamed");
    expect(stored?.inputs.lot.priceCents).toBe(NEW_PRICE);
  });
});

describe("useDealEditor autosave", () => {
  it("shows a failed save as an error, then retries after 5,000 ms and saves", async () => {
    const s = await setup();
    s.saveDeal.mockRejectedValueOnce(new Error("Couldn't save — browser storage is full or unavailable"));
    const view = await ready(s);

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(view.result.current.saveStatus).toEqual({
      kind: "error",
      message: "Couldn't save — browser storage is full or unavailable",
      reason: "unknown",
    });
    // The editor keeps working while the save is failing.
    expect(view.result.current.inputs?.lot.priceCents).toBe(NEW_PRICE);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(ORIGINAL_PRICE);

    await advance(4999);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(s.saveDeal).toHaveBeenCalledTimes(2);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
  });

  it("asks before the page closes while saves are failing, and stops asking once a save works", async () => {
    const s = await setup();
    s.saveDeal.mockRejectedValueOnce(new Error("disk is full"));
    const view = await ready(s);
    /** Whether closing the page now would make the browser ask first. */
    const asks = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(asks()).toBe(false);

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    // Waiting to be saved is not failing: the way out saves it.
    expect(asks()).toBe(false);
    await advance(1000);
    expect(view.result.current.saveStatus.kind).toBe("error");
    expect(asks()).toBe(true);
    expect(asks()).toBe(true);

    await advance(5000);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    expect(asks()).toBe(false);
  });

  it("keeps asking through edits and retries between failures, until a save works", async () => {
    const s = await setup();
    s.saveDeal.mockRejectedValueOnce(new Error("disk is full")).mockRejectedValueOnce(new Error("disk is full"));
    const view = await ready(s);
    const asks = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(view.result.current.saveStatus.kind).toBe("error");
    // A new edit while saves are failing: waiting to be saved again, but the last save failed.
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100)));
    expect(view.result.current.saveStatus.kind).toBe("pending");
    expect(asks()).toBe(true);
    await advance(1000);
    expect(view.result.current.saveStatus.kind).toBe("error");
    expect(asks()).toBe(true);
    await advance(5000);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    expect(asks()).toBe(false);
  });

  it("stops asking when the editor goes away", async () => {
    const s = await setup();
    s.saveDeal.mockRejectedValue(new Error("disk is full"));
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(view.result.current.saveStatus.kind).toBe("error");
    vi.spyOn(console, "error").mockImplementation(() => {});
    view.unmount();
    await advance(0);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("shows the repository's own refusal when it will not store the deal", async () => {
    const s = await setup();
    const view = await ready(s);
    // NaN turns into null in the stored JSON, so the record would not read back and the repository refuses it.
    act(() =>
      view.result.current.edit((draft) => {
        draft.lot.priceCents = Number.NaN;
      }),
    );
    await advance(1000);
    const status = view.result.current.saveStatus;
    expect(status.kind).toBe("error");
    expect(status.kind === "error" && status.message).toMatch(/^Couldn't save — /);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(ORIGINAL_PRICE);
  });

  it("saves the pending edit when the editor goes away", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    expect(s.saveDeal).not.toHaveBeenCalled();

    view.unmount();
    await advance(0);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
    // Nothing is saved twice once the delay would have run out.
    await advance(30_000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
  });

  it("saves nothing on unmount when there is nothing to save", async () => {
    const s = await setup();
    const view = await ready(s);
    view.unmount();
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
  });

  it("saves a pending rename when the editor goes away", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => {
      view.result.current.rename("Leaving soon");
    });
    view.unmount();
    await advance(0);
    expect((await s.storedDeal(s.first.id))?.name).toBe("Leaving soon");
  });

  it("works in StrictMode: no save for loading, one save per change", async () => {
    const s = await setup();
    const view = await ready(s, undefined, { strict: true });
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
    expect(view.result.current.canUndo).toBe(true);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
  });
});

/** Makes `document.visibilityState` read `state` until the returned function is called. */
function setVisibility(state: DocumentVisibilityState): () => void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  return () => {
    delete (document as { visibilityState?: unknown }).visibilityState;
  };
}

describe("useDealEditor when the page is hidden or closed", () => {
  /** What the storage holds for the deal right now, read straight from it with no await in between. */
  const storedPrice = (s: Setup): number | undefined => {
    const records = JSON.parse(s.storage.getItem(DEALS_KEY) ?? "{}") as Record<string, StoredDeal>;
    return records[s.first.id]?.inputs.lot.priceCents;
  };

  it("saves the pending edit on pagehide, before any timer runs and before the event handler returns", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    expect(storedPrice(s)).toBe(ORIGINAL_PRICE);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      // Still inside the event: a closing page gets no later turn, so the write must already be in the storage.
      expect(s.saveDeal).toHaveBeenCalledTimes(1);
      expect(storedPrice(s)).toBe(NEW_PRICE);
    });
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
    // The delay timer was cancelled, so the edit is not saved again when it would have run out.
    await advance(30_000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
  });

  it("saves a pending rename on pagehide", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => {
      view.result.current.rename("Closing soon");
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect((await s.storedDeal(s.first.id))?.name).toBe("Closing soon");
  });

  it("saves the pending edit when the page becomes hidden", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    const restore = setVisibility("hidden");
    try {
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
        expect(s.saveDeal).toHaveBeenCalledTimes(1);
        expect(storedPrice(s)).toBe(NEW_PRICE);
      });
    } finally {
      restore();
    }
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
  });

  it("does not save when the page becomes visible again", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    const restore = setVisibility("visible");
    try {
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    } finally {
      restore();
    }
    expect(s.saveDeal).not.toHaveBeenCalled();
    // The normal delay still applies.
    await advance(1000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
  });

  it("saves nothing when nothing is waiting", async () => {
    const s = await setup();
    await ready(s);
    const restore = setVisibility("hidden");
    try {
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
    } finally {
      restore();
    }
    await advance(30_000);
    expect(s.saveDeal).not.toHaveBeenCalled();
  });

  it("keeps working after a flush: the next edit is saved after its own delay", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await advance(0);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });

    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100_000)));
    await advance(999);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(s.saveDeal).toHaveBeenCalledTimes(2);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE + 100_000);
  });

  it("stops listening when the editor goes away or moves to another deal", async () => {
    const s = await setup();
    const view = await ready(s);
    const onWindow = { add: vi.spyOn(window, "addEventListener"), remove: vi.spyOn(window, "removeEventListener") };
    const onDocument = { add: vi.spyOn(document, "addEventListener"), remove: vi.spyOn(document, "removeEventListener") };
    const handlers = (spy: { mock: { calls: unknown[][] } }, type: string) =>
      spy.mock.calls.filter(([name]) => name === type).map(([, handler]) => handler);

    // Moving to another deal replaces the autosaver, and with it the listeners.
    view.rerender({ dealId: "deal-elsewhere" });
    expect(handlers(onWindow.add, "pagehide")).toHaveLength(1);
    expect(handlers(onWindow.remove, "pagehide")).toHaveLength(1);
    expect(handlers(onDocument.add, "visibilitychange")).toHaveLength(1);
    expect(handlers(onDocument.remove, "visibilitychange")).toHaveLength(1);

    view.unmount();
    for (const [add, remove, type] of [
      [onWindow.add, onWindow.remove, "pagehide"],
      [onDocument.add, onDocument.remove, "visibilitychange"],
    ] as const) {
      // The first autosaver's handler was added before the spies (removed on the move), the second's is added and then
      // removed on unmount: nothing stays registered.
      expect(handlers(add, type)).toHaveLength(1);
      expect(handlers(remove, type)).toHaveLength(2);
      expect(handlers(remove, type)).toContain(handlers(add, type)[0]);
    }
  });
});

describe("useDealEditor with another deal", () => {
  it("saves the old deal's pending edit and loads the new deal without showing the old one", async () => {
    const s = await setup();
    const inputs2 = sampleDealInputs();
    inputs2.lot.priceCents = 9_900_000;
    const second = await s.repository.createDeal({ name: "Second deal", inputs: inputs2 });
    const view = await ready(s);

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    view.rerender({ dealId: second.id });
    // Not the old deal's data under the new id.
    expect(view.result.current.status).toBe("loading");
    expect(view.result.current.inputs).toBeUndefined();
    expect(view.result.current.deal).toBeUndefined();

    await settle(view);
    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.deal?.id).toBe(second.id);
    expect(view.result.current.deal?.name).toBe("Second deal");
    expect(view.result.current.inputs?.lot.priceCents).toBe(9_900_000);
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });

    // The first deal's edit was saved on the way out, and the second deal was left alone.
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect((await s.storedDeal(second.id))?.inputs.lot.priceCents).toBe(9_900_000);

    // And editing the second deal saves the second deal.
    act(() => view.result.current.edit(setPrice(7_700_000)));
    await advance(1000);
    expect((await s.storedDeal(second.id))?.inputs.lot.priceCents).toBe(7_700_000);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
  });
});

describe("useDealEditor saves and the conflict check", () => {
  /** Makes the next `saveDeal` wait for `release`, then run for real. */
  function gateNextSave(s: Setup) {
    const real = createLocalRepository(s.storage);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const returned: StoredDeal[] = [];
    s.saveDeal.mockImplementationOnce(async (deal, options) => {
      await gate;
      const saved = await real.saveDeal(deal, options);
      returned.push(saved);
      return saved;
    });
    return { release: () => release(), returned };
  }

  it("builds each save on the updatedAt of the last one, so edits made during a save do not conflict", async () => {
    const s = await setup();
    const { release, returned } = gateNextSave(s);
    const view = await ready(s);

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    // A second edit while the first save is still running: its deal was built from the data read before that save.
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100_000)));
    await advance(1000);
    release();
    await advance(50);

    expect(s.saveDeal).toHaveBeenCalledTimes(2);
    const [first, second] = s.saveDeal.mock.calls.map(([deal]) => deal);
    expect(first?.updatedAt).toBe(s.first.updatedAt);
    expect(returned).toHaveLength(1);
    expect(second?.updatedAt).toBe(returned[0]?.updatedAt);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE + 100_000);
  });

  it("builds the save at unmount on the last updatedAt too, when a save is running as the page goes", async () => {
    const s = await setup();
    const { release, returned } = gateNextSave(s);
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100_000)));
    view.unmount();
    release();
    await advance(50);
    expect(s.saveDeal).toHaveBeenCalledTimes(2);
    expect(s.saveDeal.mock.calls[1]?.[0].updatedAt).toBe(returned[0]?.updatedAt);
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE + 100_000);
  });

  it("still ends in a conflict when a refetch brings another device's newer copy: the cache's stamp is not used", async () => {
    const s = await setup();
    const view = await ready(s);
    // Another device saves the deal, and this one reads it again.
    await advance(5);
    const other = createLocalRepository(s.storage);
    await other.saveDeal({ ...s.first, name: "Other device" });
    await act(async () => {
      await s.client.invalidateQueries({ queryKey: queryKeys.deal(s.first.id) });
    });
    await advance(10);

    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);

    expect(s.saveDeal.mock.calls[0]?.[0].updatedAt).toBe(s.first.updatedAt);
    expect(view.result.current.saveStatus).toMatchObject({
      kind: "error",
      message: "This deal was changed on another device or tab.",
      reason: "conflict",
    });
    expect((await s.storedDeal(s.first.id))?.name).toBe("Other device");
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(ORIGINAL_PRICE);
  });

  it("retries a failed save from the last good updatedAt", async () => {
    const s = await setup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    const good = await s.storedDeal(s.first.id);
    expect(good?.updatedAt).not.toBe(s.first.updatedAt);

    s.saveDeal.mockImplementationOnce(async () => {
      throw new DataError("Can't reach the server — check your connection.", { kind: "offline" });
    });
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100_000)));
    await advance(1000);
    expect(view.result.current.saveStatus.kind).toBe("error");
    await advance(5000);

    expect(s.saveDeal).toHaveBeenCalledTimes(3);
    const stamps = s.saveDeal.mock.calls.map(([deal]) => deal.updatedAt);
    expect(stamps[1]).toBe(good?.updatedAt);
    expect(stamps[2]).toBe(good?.updatedAt);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE + 100_000);
  });

  it("keeps each deal's baseline apart: a late save of the deal just left does not touch the next one's", async () => {
    const s = await setup();
    const second = await s.repository.createDeal({ name: "Second", inputs: sampleDealInputs() });
    const { release } = gateNextSave(s);
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);

    view.rerender({ dealId: second.id });
    await settle(view, (e) => e.status === "ready" && e.deal?.id === second.id);
    release();
    await advance(50);

    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100_000)));
    await advance(1000);

    const call = s.saveDeal.mock.calls.find(([deal]) => deal.id === second.id);
    expect(call?.[0].updatedAt).toBe(second.updatedAt);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    expect((await s.storedDeal(second.id))?.inputs.lot.priceCents).toBe(NEW_PRICE + 100_000);
  });
});

describe("useDealEditor save problems", () => {
  const asks = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const offlineError = () => new DataError("Offline — your changes are saved on this device and will sync.", { kind: "offline" });
  const signedOutError = () => new DataError("Signed out — sign in to sync.", { kind: "signedOut" });

  /** A setup whose repository keeps an outbox, as the hosted app does. */
  async function withOutbox() {
    let offline!: OfflineRepository;
    const s = await setup({}, (remote) => (offline = createOfflineRepository(remote, new MemoryStorage(), "u")));
    return { s, offline };
  }

  /** A deal whose stored copy another device changed after this editor read it. */
  async function conflicted(s: Setup, view: View) {
    await advance(5);
    await createLocalRepository(s.storage).saveDeal({ ...s.first, name: "Other device", inputs: { ...s.first.inputs, contingencyPct: 0.02 } });
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(view.result.current.saveStatus).toMatchObject({ kind: "error", reason: "conflict" });
  }

  it("says offline, keeps retrying, and does not ask before the page closes", async () => {
    const { s } = await withOutbox();
    s.saveDeal.mockRejectedValueOnce(offlineError()).mockRejectedValueOnce(offlineError());
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(view.result.current.saveStatus).toMatchObject({ kind: "error", reason: "offline" });
    expect(asks()).toBe(false);
    // A new edit in between does not bring the prompt back: the outbox holds it.
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100)));
    expect(asks()).toBe(false);
    await advance(1000);
    await advance(5000);
    expect(s.saveDeal.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
  });

  it("says signed out, and does not ask before the page closes", async () => {
    const { s } = await withOutbox();
    s.saveDeal.mockRejectedValueOnce(signedOutError());
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(view.result.current.saveStatus).toMatchObject({ kind: "error", reason: "signedOut" });
    expect(asks()).toBe(false);
    await advance(5000);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
  });

  it("without an outbox, offline is a plain failure: it asks before the page closes", async () => {
    const s = await setup();
    s.saveDeal.mockRejectedValueOnce(offlineError());
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(view.result.current.saveStatus).toMatchObject({ kind: "error", reason: "failed" });
    expect(asks()).toBe(true);
  });

  it("still asks before the page closes for a failure that is not on the device", async () => {
    const s = await setup();
    s.saveDeal.mockRejectedValueOnce(new DataError("The server refused it", { kind: "failed" }));
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(view.result.current.saveStatus).toMatchObject({ kind: "error", reason: "failed" });
    expect(asks()).toBe(true);
  });

  it("does not retry a conflict, asks before closing, and tries again after a later edit", async () => {
    const s = await setup();
    const view = await ready(s);
    await conflicted(s, view);
    expect(asks()).toBe(true);
    await advance(30_000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect(view.result.current.saveStatus).toMatchObject({ kind: "error", reason: "conflict" });
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100)));
    await advance(1000);
    expect(s.saveDeal).toHaveBeenCalledTimes(2);
  });

  it("keepMine saves the local version over the other device's", async () => {
    const s = await setup();
    const view = await ready(s);
    await conflicted(s, view);
    act(() => view.result.current.keepMine());
    await advance(50);
    expect(s.saveDeal.mock.calls.at(-1)?.[1]).toEqual({ overwrite: true });
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
    expect(asks()).toBe(false);
  });

  it("loadTheirs replaces the inputs with the stored ones, clears undo, and does not save them back", async () => {
    const s = await setup();
    const view = await ready(s);
    await conflicted(s, view);
    expect(view.result.current.canUndo).toBe(true);
    await act(async () => {
      await view.result.current.loadTheirs();
    });
    await advance(5000);
    const editor = view.result.current;
    expect(editor.inputs?.contingencyPct).toBe(0.02);
    expect(editor.inputs?.lot.priceCents).toBe(ORIGINAL_PRICE);
    expect(editor.deal?.name).toBe("Other device");
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(editor.saveStatus).toEqual({ kind: "saved" });
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect(asks()).toBe(false);
    // And it saves cleanly from the new version.
    act(() => editor.edit(setPrice(NEW_PRICE + 5)));
    await advance(1000);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE + 5);
  });

  it("after reopening mid-flush, loadTheirs brings back the owner's own flushed edit and then saves cleanly", async () => {
    const s = await setup();
    const view = await ready(s);
    // The previous editor's unmount flush lands after this editor seeded from the cache.
    await advance(5);
    await createLocalRepository(s.storage).saveDeal({ ...s.first, inputs: { ...s.first.inputs, lot: { ...s.first.inputs.lot, priceCents: NEW_PRICE } } });
    act(() => view.result.current.edit((d) => { d.contingencyPct = 0.03; }));
    await advance(1000);
    expect(view.result.current.saveStatus).toMatchObject({ kind: "error", reason: "conflict" });
    await act(async () => {
      await view.result.current.loadTheirs();
    });
    expect(view.result.current.inputs?.lot.priceCents).toBe(NEW_PRICE);
    act(() => view.result.current.edit((d) => { d.contingencyPct = 0.03; }));
    await advance(1000);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    const stored = await s.storedDeal(s.first.id);
    expect(stored?.inputs.lot.priceCents).toBe(NEW_PRICE);
    expect(stored?.inputs.contingencyPct).toBe(0.03);
  });

  it("ignores edits made while Load their version is reading, so they cannot overwrite theirs", async () => {
    const s = await setup();
    const view = await ready(s);
    await conflicted(s, view);
    const real = s.repository.getDeal.bind(s.repository);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    s.repository.getDeal = async (id) => {
      await gate;
      return real(id);
    };
    let loading!: Promise<void>;
    act(() => {
      loading = view.result.current.loadTheirs();
    });
    expect(view.result.current.busy).toBe(true);
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 777)));
    act(() => {
      view.result.current.rename("Typed while loading");
    });
    release();
    await act(async () => {
      await loading;
    });
    await advance(5000);
    expect(view.result.current.busy).toBe(false);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect(view.result.current.inputs?.lot.priceCents).toBe(ORIGINAL_PRICE);
    expect(view.result.current.deal?.name).toBe("Other device");
    expect((await s.storedDeal(s.first.id))?.name).toBe("Other device");
  });

  it("a failed Load their version puts the conflict and the outbox entry back", async () => {
    const { s, offline } = await withOutbox();
    const view = await ready(s);
    await conflicted(s, view);
    expect(offline.pending()).toHaveLength(1);
    const real = s.repository.getDeal.bind(s.repository);
    s.repository.getDeal = async () => {
      throw new DataError("Can't reach the server", { kind: "offline" });
    };
    await act(async () => {
      await expect(view.result.current.loadTheirs()).rejects.toThrow("Can't reach the server");
    });
    expect(view.result.current.saveStatus).toMatchObject({ kind: "error", reason: "conflict" });
    expect(view.result.current.inputs?.lot.priceCents).toBe(NEW_PRICE);
    expect(view.result.current.busy).toBe(false);
    expect(offline.pending().map((p) => p.dealId)).toEqual([s.first.id]);
    // The owner can still choose.
    s.repository.getDeal = real;
    act(() => view.result.current.keepMine());
    await advance(50);
    expect(view.result.current.saveStatus).toEqual({ kind: "saved" });
    expect((await s.storedDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
  });

  it("leaving a deal while offline or signed out raises no lost-save banner when an outbox holds the edit", async () => {
    for (const make of [offlineError, signedOutError]) {
      resetLostSaves();
      const { s } = await withOutbox();
      s.saveDeal.mockRejectedValueOnce(make());
      vi.spyOn(console, "error").mockImplementation(() => {});
      const lost = renderHook(() => useLostSaves());
      const view = await ready(s);
      act(() => view.result.current.edit(setPrice(NEW_PRICE)));
      view.unmount();
      await advance(1000);
      expect(lost.result.current).toEqual([]);
    }
  });

  it("leaving a deal with a plain failure still raises the lost-save banner, with an outbox too", async () => {
    const { s } = await withOutbox();
    s.saveDeal.mockRejectedValueOnce(new DataError("The server refused it", { kind: "failed" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lost = renderHook(() => useLostSaves());
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    view.unmount();
    await advance(1000);
    expect(lost.result.current).toHaveLength(1);
  });

  it("discardDeletedDeal clears the outbox entry", async () => {
    const { s, offline } = await withOutbox();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await createLocalRepository(s.storage).deleteDeal(s.first.id);
    await advance(1000);
    expect(offline.pending()).toHaveLength(1);
    act(() => view.result.current.discardDeletedDeal());
    expect(offline.pending()).toHaveLength(0);
    await advance(30_000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
  });

  it("Load their version offline never takes this device's own copy for theirs: it fails and the choice stays", async () => {
    let remote!: Repository;
    let offline!: OfflineRepository;
    const s = await setup({}, (server) => {
      remote = server;
      return (offline = createOfflineRepository(server, new MemoryStorage(), "u"));
    });
    // Opening the deal keeps a copy of it on the device, through the real outbox.
    const view = await ready(s);
    await conflicted(s, view);
    expect(offline.pending()).toHaveLength(1);
    vi.spyOn(remote, "getDeal").mockRejectedValue(offlineError());

    await act(async () => {
      await expect(view.result.current.loadTheirs()).rejects.toMatchObject({ kind: "offline" });
    });
    expect(view.result.current.saveStatus).toMatchObject({ kind: "error", reason: "conflict" });
    expect(view.result.current.inputs?.lot.priceCents).toBe(NEW_PRICE);
    expect(view.result.current.canUndo).toBe(true);
    expect(offline.pending().map((p) => p.dealId)).toEqual([s.first.id]);
    expect((await offline.getDeal(s.first.id))?.inputs.lot.priceCents).toBe(NEW_PRICE);
  });

  it("loadTheirs drops the outbox entry of an offline repository", async () => {
    let offline!: OfflineRepository;
    const s = await setup({}, (remote) => (offline = createOfflineRepository(remote, new MemoryStorage(), "u")));
    const discard = vi.spyOn(offline, "discardPending");
    const view = await ready(s);
    await conflicted(s, view);
    expect(offline.pending()).toHaveLength(1);
    await act(async () => {
      await view.result.current.loadTheirs();
    });
    expect(discard).toHaveBeenCalledWith(s.first.id);
    expect(offline.pending()).toHaveLength(0);
    expect(view.result.current.inputs?.contingencyPct).toBe(0.02);
  });

  it("a deleted deal is not retried, asks before closing, and saveAsNewDeal keeps the name and edits", async () => {
    let offline!: OfflineRepository;
    const s = await setup({}, (remote) => (offline = createOfflineRepository(remote, new MemoryStorage(), "u")));
    const discard = vi.spyOn(offline, "discardPending");
    const view = await ready(s);
    act(() => view.result.current.rename("Kept name"));
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await createLocalRepository(s.storage).deleteDeal(s.first.id);
    await advance(1000);
    expect(view.result.current.saveStatus).toMatchObject({ kind: "error", reason: "deleted" });
    await advance(30_000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect(asks()).toBe(true);

    let newId = "";
    await act(async () => {
      newId = await view.result.current.saveAsNewDeal();
    });
    expect(newId).not.toBe(s.first.id);
    const created = await s.storedDeal(newId);
    expect(created?.name).toBe("Kept name");
    expect(created?.inputs.lot.priceCents).toBe(NEW_PRICE);
    expect(discard).toHaveBeenCalledWith(s.first.id);
    expect(offline.pending().some((p) => p.dealId === s.first.id)).toBe(false);
    await advance(30_000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    expect(await s.storedDeal(s.first.id)).toBeNull();
  });
});

describe("useDealEditor closing the page with an outbox", () => {
  const entriesOf = (outbox: MemoryStorage): { base: string; deal: StoredDeal }[] =>
    (JSON.parse(outbox.getItem("spec-studio:outbox:u") ?? '{"entries":[]}') as { entries: { base: string; deal: StoredDeal }[] }).entries;

  async function gatedSetup() {
    const outbox = new MemoryStorage();
    let offline!: OfflineRepository;
    const s = await setup({}, (remote) => (offline = createOfflineRepository(remote, outbox, "u")));
    const real = s.saveDeal.getMockImplementation() as Repository["saveDeal"];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    // The first save waits; later ones run.
    s.saveDeal.mockImplementationOnce(async (deal, options) => {
      await gate;
      return real(deal, options);
    });
    return { s, outbox, offline, release: () => release() };
  }

  it("queues the newest edit synchronously when a save is already running", async () => {
    const { s, outbox, offline } = await gatedSetup();
    const queue = vi.spyOn(offline, "queue");
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    expect(s.saveDeal).toHaveBeenCalledTimes(1);
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100_000)));
    expect(entriesOf(outbox)[0]?.deal.inputs.lot.priceCents).toBe(NEW_PRICE);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      expect(queue).toHaveBeenCalledTimes(1);
      expect(entriesOf(outbox)[0]?.deal.inputs.lot.priceCents).toBe(NEW_PRICE + 100_000);
    });
  });

  it("queues with the editor's baseline, not the cached updatedAt", async () => {
    const { s, outbox, offline, release } = await gatedSetup();
    const queue = vi.spyOn(offline, "queue");
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    // Built while the first save ran, so it carries the old updatedAt.
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100_000)));
    release();
    await advance(20);
    const landed = await s.storedDeal(s.first.id);
    expect(landed?.updatedAt).not.toBe(s.first.updatedAt);
    expect(entriesOf(outbox)).toHaveLength(0);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(queue).toHaveBeenCalledTimes(1);
    expect(queue.mock.calls[0]?.[0].updatedAt).toBe(landed?.updatedAt);
    expect(entriesOf(outbox)[0]?.base).toBe(landed?.updatedAt);
  });

  it("queues on visibilitychange to hidden too", async () => {
    const { s, outbox, release } = await gatedSetup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100_000)));
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    hidden.mockRestore();
    expect(entriesOf(outbox)[0]?.deal.inputs.lot.priceCents).toBe(NEW_PRICE + 100_000);
    release();
  });

  it("queues the newest edit when the editor unmounts while a save is running", async () => {
    const { s, outbox, release } = await gatedSetup();
    const view = await ready(s);
    act(() => view.result.current.edit(setPrice(NEW_PRICE)));
    await advance(1000);
    act(() => view.result.current.edit(setPrice(NEW_PRICE + 100_000)));
    view.unmount();
    expect(entriesOf(outbox)[0]?.deal.inputs.lot.priceCents).toBe(NEW_PRICE + 100_000);
    release();
  });

  it("does not queue when nothing is waiting", async () => {
    const { s, offline } = await gatedSetup();
    const queue = vi.spyOn(offline, "queue");
    await ready(s);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(queue).not.toHaveBeenCalled();
  });
});
