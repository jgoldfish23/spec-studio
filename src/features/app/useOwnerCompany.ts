import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Company, CompanyGateway } from "../../data/auth/companyGateway";
import type { OwnerMemory } from "../../data/auth/rememberedOwner";
import { DataError } from "../../data/types";

/**
 * The signed-in owner's company, for the hosted gate. A company this device remembers for the owner opens the app at
 * once, and the server is asked behind it: its answer refreshes the memory, and a different company is followed. (No
 * company at all, for an owner who had one, should not happen; it is said once, and the owner is asked to set one
 * up.) With nothing remembered, the gate waits for the server. When the server can't be reached, the remembered
 * company stands in; with none, the error stands.
 */
export function useOwnerCompany({
  userId,
  companies,
  memory,
}: {
  userId: string;
  companies: CompanyGateway;
  memory: OwnerMemory;
}) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["company", userId] as const, [userId]);
  const [remembered] = useState(() => memory.company(userId));
  const reportedGone = useRef(false);

  const company = useQuery({
    queryKey,
    queryFn: async () => {
      let found: Company | null;
      try {
        found = await companies.myCompany();
      } catch (error) {
        const fallback =
          error instanceof DataError && error.kind === "offline"
            ? memory.company(userId)
            : null;
        if (fallback) return fallback;
        if (!(error instanceof DataError))
          console.error("Couldn't load the company:", error);
        throw error;
      }
      if (found) {
        memory.rememberCompany(userId, found);
      } else {
        if (memory.company(userId) && !reportedGone.current) {
          reportedGone.current = true;
          console.error(
            "The server has no company for an owner this device remembered one for; asking to set one up.",
          );
        }
        memory.forgetCompany(userId);
      }
      return found;
    },
    // A remembered company is shown straight away and is stale from the start, so the server is asked behind it.
    ...(remembered
      ? { initialData: remembered, initialDataUpdatedAt: 0, staleTime: 0 }
      : { staleTime: Infinity }),
  });

  const { refetch } = company;
  const retry = useCallback(() => {
    // A first read that never answered is still "fetching", and a refetch would only wait on it: drop it first.
    void queryClient.cancelQueries({ queryKey }).then(() => refetch());
  }, [queryClient, queryKey, refetch]);

  const created = useCallback(
    (made: Company) => {
      memory.rememberCompany(userId, made);
      queryClient.setQueryData(queryKey, made);
    },
    [memory, userId, queryClient, queryKey],
  );

  return { company, retry, created };
}
