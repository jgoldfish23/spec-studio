import { testSampleComps } from "../testing/sampleIds";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_QUANTITY_RULES, DEFAULT_RULES } from "@engine";
import { createLocalRepository } from "./local/localRepository";
import { createQueryClient } from "./queryClient";
import {
  useCompanySettings,
  useComps,
  useCreateDeal,
  useDeal,
  useDeals,
  useDeleteComp,
  useDeleteDeal,
  useEngineContext,
  useRepository,
  useResetDeals,
  useSaveComp,
} from "./queries";
import { RepositoryProvider } from "./RepositoryProvider";
import { sampleDealInputs } from "./sample";
import { STARTER_COST_BOOK } from "./starterCostBook";
import { MemoryStorage } from "./local/memoryStorage";
import { DataError } from "./types";
import type { Repository } from "./types";

function setup(repoOverrides: Partial<Repository> = {}) {
  const storage = new MemoryStorage();
  let n = 0;
  const base = createLocalRepository(storage, { newId: () => `deal-${++n}` });
  const repository: Repository = { ...base, ...repoOverrides };
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RepositoryProvider repository={repository}>{children}</RepositoryProvider>
    </QueryClientProvider>
  );
  return { storage, repository, base, client, wrapper };
}

const isInvalidated = (client: QueryClient, key: unknown[]): boolean => client.getQueryState(key)?.isInvalidated === true;

afterEach(() => {
  vi.useRealTimers();
});

describe("createQueryClient", () => {
  it("does not retry and does not refetch on window focus", () => {
    const options = createQueryClient().getDefaultOptions().queries;
    expect(options?.retry).toBe(false);
    expect(options?.refetchOnWindowFocus).toBe(false);
  });
});

describe("useRepository", () => {
  it("returns the repository it was given", () => {
    const { repository, wrapper } = setup();
    const { result } = renderHook(() => useRepository(), { wrapper });
    expect(result.current).toBe(repository);
  });

  it("fails with a clear message outside a RepositoryProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useRepository())).toThrow(/RepositoryProvider/);
    spy.mockRestore();
  });
});

describe("deal hooks", () => {
  it("useDeals lists the stored deals", async () => {
    const { base, wrapper } = setup();
    await base.createDeal({ name: "One", inputs: sampleDealInputs() });
    const { result } = renderHook(() => useDeals(), { wrapper });
    await waitFor(() => expect(result.current.data?.deals.map((d) => d.name)).toEqual(["One"]));
  });

  it("useDeal reads one deal, and null for an id nobody stored", async () => {
    const { base, wrapper } = setup();
    const created = await base.createDeal({ name: "One", inputs: sampleDealInputs() });
    const found = renderHook(() => useDeal(created.id), { wrapper });
    await waitFor(() => expect(found.result.current.data?.name).toBe("One"));
    const missing = renderHook(() => useDeal("nope"), { wrapper });
    await waitFor(() => expect(missing.result.current.isSuccess).toBe(true));
    expect(missing.result.current.data).toBeNull();
  });

  it("useCreateDeal creates the deal and refreshes the list", async () => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => ({ list: useDeals(), create: useCreateDeal() }), { wrapper });
    await waitFor(() => expect(result.current.list.data?.deals).toEqual([]));

    let created: Awaited<ReturnType<typeof result.current.create.mutateAsync>> | undefined;
    await act(async () => {
      created = await result.current.create.mutateAsync({ name: "New deal", inputs: sampleDealInputs() });
    });
    expect(created?.name).toBe("New deal");
    await waitFor(() => expect(result.current.list.data?.deals.map((d) => d.name)).toEqual(["New deal"]));
    expect(isInvalidated(client, ["deals"])).toBe(false); // refetched, so fresh again
  });

  it("useDeleteDeal deletes the deal, forgets its cache entry and refreshes the list", async () => {
    const { base, wrapper, client } = setup();
    const created = await base.createDeal({ name: "Doomed", inputs: sampleDealInputs() });
    const { result } = renderHook(() => ({ list: useDeals(), one: useDeal(created.id), del: useDeleteDeal() }), { wrapper });
    await waitFor(() => expect(result.current.list.data?.deals).toHaveLength(1));
    await waitFor(() => expect(result.current.one.data?.name).toBe("Doomed"));

    await act(async () => {
      await result.current.del.mutateAsync(created.id);
    });
    expect(await base.getDeal(created.id)).toBeNull();
    await waitFor(() => expect(result.current.list.data?.deals).toEqual([]));
    // The single-deal entry was removed, not left holding the deleted deal.
    expect(client.getQueryData(["deal", created.id])).not.toEqual(expect.objectContaining({ name: "Doomed" }));
  });
});

describe("useResetDeals", () => {
  it("removes every deal, forgets every deal's cache entry and refreshes the list", async () => {
    const { base, wrapper, client } = setup();
    const first = await base.createDeal({ name: "One", inputs: sampleDealInputs() });
    const second = await base.createDeal({ name: "Two", inputs: sampleDealInputs() });
    const { result } = renderHook(
      () => ({ list: useDeals(), one: useDeal(first.id), two: useDeal(second.id), reset: useResetDeals() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.deals).toHaveLength(2));
    await waitFor(() => expect(result.current.one.data?.name).toBe("One"));
    await waitFor(() => expect(result.current.two.data?.name).toBe("Two"));

    await act(async () => {
      await result.current.reset.mutateAsync();
    });
    expect((await base.listDeals()).deals).toEqual([]);
    await waitFor(() => expect(result.current.list.data?.deals).toEqual([]));
    // The single-deal entries were removed, not left holding deals that are gone: reading them again finds nothing.
    await waitFor(() => expect(result.current.one.data).toBeNull());
    await waitFor(() => expect(result.current.two.data).toBeNull());
    expect(client.getQueryData(["deal", first.id])).not.toEqual(expect.objectContaining({ name: "One" }));
    expect(client.getQueryData(["deal", second.id])).not.toEqual(expect.objectContaining({ name: "Two" }));
  });

  it("reports a failure to reset and leaves the list as it was", async () => {
    const { base, wrapper, client } = setup({ resetDeals: async () => Promise.reject(new DataError("storage is locked")) });
    await base.createDeal({ name: "Keep", inputs: sampleDealInputs() });
    const { result } = renderHook(() => ({ list: useDeals(), reset: useResetDeals() }), { wrapper });
    await waitFor(() => expect(result.current.list.data?.deals).toHaveLength(1));
    await act(async () => {
      await expect(result.current.reset.mutateAsync()).rejects.toThrow("storage is locked");
    });
    expect(isInvalidated(client, ["deals"])).toBe(false);
    expect(result.current.list.data?.deals).toHaveLength(1);
  });
});

describe("comp hooks", () => {
  it("useComps lists a region's comps; saving and deleting a comp refresh it", async () => {
    const { wrapper } = setup();
    const [first, second] = testSampleComps();
    if (!first || !second) throw new Error("the sample has comps");
    const { result } = renderHook(() => ({ comps: useComps("utah-north"), save: useSaveComp(), del: useDeleteComp() }), { wrapper });
    await waitFor(() => expect(result.current.comps.data).toEqual([]));

    await act(async () => {
      await result.current.save.mutateAsync(first);
      await result.current.save.mutateAsync(second);
    });
    await waitFor(() => expect(result.current.comps.data?.map((c) => c.id).sort()).toEqual([first.id, second.id].sort()));

    await act(async () => {
      await result.current.del.mutateAsync(first.id);
    });
    await waitFor(() => expect(result.current.comps.data?.map((c) => c.id)).toEqual([second.id]));
  });

  it("useComps stays idle for an empty region", async () => {
    const listComps = vi.fn(async () => []);
    const { wrapper } = setup({ listComps });
    const { result } = renderHook(() => useComps(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(listComps).not.toHaveBeenCalled();
  });
});

describe("useCompanySettings", () => {
  it("reads the company settings", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCompanySettings(), { wrapper });
    await waitFor(() => expect(result.current.data?.rules).toEqual(DEFAULT_RULES));
    expect(result.current.data?.contingencyPct).toBe(0.05);
  });
});

describe("useEngineContext", () => {
  it("combines the cost book, comps, market settings and quantity rules, with today's local date", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 31, 20, 0) });
    const { base, wrapper } = setup();
    const comps = testSampleComps();
    for (const comp of comps) await base.saveComp(comp);

    const { result } = renderHook(() => useEngineContext("utah-north"), { wrapper });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.isLoading).toBe(false);
    const ctx = result.current.data;
    expect(ctx?.today).toBe("2026-10-31");
    expect(ctx?.costBook).toEqual({ defaults: STARTER_COST_BOOK, priceBook: [] });
    expect(ctx?.comps.map((c) => c.id).sort()).toEqual(comps.map((c) => c.id).sort());
    expect(ctx?.marketSettings).toEqual({ ...DEFAULT_MARKET_SETTINGS, region: "utah-north" });
    expect(ctx?.quantityRules).toBe(DEFAULT_QUANTITY_RULES);
  });

  it("keeps the same context object while nothing it is built from changes", async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(() => useEngineContext("utah-north"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const first = result.current.data;
    rerender();
    expect(result.current.data).toBe(first);
  });

  it.each([[""], [undefined]])("is idle and not loading for the region %j", (region) => {
    const getCostBook = vi.fn();
    const { wrapper } = setup({ getCostBook });
    const { result } = renderHook(() => useEngineContext(region), { wrapper });
    expect(result.current).toEqual({ data: undefined, isLoading: false, error: null });
    expect(getCostBook).not.toHaveBeenCalled();
  });

  it("reports the first failure as an error and has no data", async () => {
    const boom = new DataError("cost book is unreadable");
    const { wrapper } = setup({
      getCostBook: async () => {
        throw boom;
      },
    });
    const { result } = renderHook(() => useEngineContext("utah-north"), { wrapper });
    await waitFor(() => expect(result.current.error).toBe(boom));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});
