import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useMemo } from "react";
import { DEFAULT_QUANTITY_RULES } from "@engine";
import type { Comp, DealInputs, EngineContext, MarketSettings } from "@engine";
import { todayIso } from "../lib/today";
import { RepositoryContext } from "./RepositoryProvider";
import type { CompanySettings, Repository } from "./types";

/** Every query key in one place, so a mutation invalidates exactly what a hook reads. */
export const queryKeys = {
  deals: ["deals"] as const,
  deal: (id: string) => ["deal", id] as const,
  /** Every single-deal entry, whichever deal: the prefix of `deal(id)`. */
  everyDeal: ["deal"] as const,
  /** Every region's comps. */
  allComps: ["comps"] as const,
  comps: (region: string) => ["comps", region] as const,
  costBook: (region: string) => ["costBook", region] as const,
  marketSettings: (region: string) => ["marketSettings", region] as const,
  companySettings: ["companySettings"] as const,
};

export function useRepository(): Repository {
  const repository = useContext(RepositoryContext);
  if (repository === null) throw new Error("useRepository must be used inside a <RepositoryProvider>.");
  return repository;
}

export function useDeals() {
  const repository = useRepository();
  return useQuery({ queryKey: queryKeys.deals, queryFn: () => repository.listDeals() });
}

/** The stored deal: `null` data when there is no such deal, an error (a `DataError`) when it cannot be read. */
export function useDeal(id: string) {
  const repository = useRepository();
  return useQuery({ queryKey: queryKeys.deal(id), queryFn: () => repository.getDeal(id) });
}

export function useCreateDeal() {
  const repository = useRepository();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; inputs: DealInputs }) => repository.createDeal(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.deals }),
  });
}

export function useDeleteDeal() {
  const repository = useRepository();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repository.deleteDeal(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.deal(id) });
      return queryClient.invalidateQueries({ queryKey: queryKeys.deals });
    },
  });
}

/** Removes every deal: the way out of a store that cannot be read. Forgets all single-deal entries, as a delete does for one. */
export function useResetDeals() {
  const repository = useRepository();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => repository.resetDeals(),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.everyDeal });
      return queryClient.invalidateQueries({ queryKey: queryKeys.deals });
    },
  });
}

/** The comps of one region. An empty region reads nothing. */
export function useComps(region: string) {
  const repository = useRepository();
  return useQuery({
    queryKey: queryKeys.comps(region),
    queryFn: () => repository.listComps(region),
    enabled: region !== "",
  });
}

export function useSaveComp() {
  const repository = useRepository();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (comp: Comp) => repository.saveComp(comp),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.allComps }),
  });
}

export function useDeleteComp() {
  const repository = useRepository();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repository.deleteComp(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.allComps }),
  });
}

export function useCompanySettings() {
  const repository = useRepository();
  return useQuery({ queryKey: queryKeys.companySettings, queryFn: () => repository.getCompanySettings() });
}

export function useSaveCompanySettings() {
  const repository = useRepository();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: CompanySettings) => repository.saveCompanySettings(settings),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.companySettings }),
  });
}

/** One region's market settings, under the key `useEngineContext` reads them with, so a save refreshes open deals. */
export function useMarketSettings(region: string) {
  const repository = useRepository();
  return useQuery({
    queryKey: queryKeys.marketSettings(region),
    queryFn: () => repository.getMarketSettings(region),
    enabled: region !== "",
  });
}

/** Saves one region's market settings. The cost book does not depend on them, so it is left alone. */
export function useSaveMarketSettings() {
  const repository = useRepository();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: MarketSettings) => repository.saveMarketSettings(settings),
    onSuccess: (saved) => queryClient.invalidateQueries({ queryKey: queryKeys.marketSettings(saved.region) }),
  });
}

export interface EngineContextResult {
  data?: EngineContext;
  /** True while any of the three reads is still on its way. */
  isLoading: boolean;
  /** The first read that failed, if any. */
  error: Error | null;
}

/**
 * What the engine needs besides the deal: the region's cost book, comps and market settings, the quantity rules and
 * today's date. With no region (`""` or `undefined`) nothing is read, and the result is not loading, just empty.
 * `data` keeps its identity until one of the reads changes, so a screen can depend on it.
 */
export function useEngineContext(region: string | undefined): EngineContextResult {
  const repository = useRepository();
  const key = region ?? "";
  const enabled = key !== "";
  const costBook = useQuery({ queryKey: queryKeys.costBook(key), queryFn: () => repository.getCostBook(key), enabled });
  const comps = useComps(key);
  const marketSettings = useQuery({
    queryKey: queryKeys.marketSettings(key),
    queryFn: () => repository.getMarketSettings(key),
    enabled,
  });

  const costBookData = costBook.data;
  const compsData = comps.data;
  const marketSettingsData = marketSettings.data;
  const data = useMemo<EngineContext | undefined>(
    () =>
      costBookData && compsData && marketSettingsData
        ? {
            today: todayIso(),
            costBook: costBookData,
            comps: compsData,
            marketSettings: marketSettingsData,
            quantityRules: DEFAULT_QUANTITY_RULES,
          }
        : undefined,
    [costBookData, compsData, marketSettingsData],
  );

  return {
    data,
    isLoading: costBook.isLoading || comps.isLoading || marketSettings.isLoading,
    error: costBook.error ?? comps.error ?? marketSettings.error,
  };
}
