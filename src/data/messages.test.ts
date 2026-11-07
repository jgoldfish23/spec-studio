import { describe, expect, it } from "vitest";
import { DEFAULT_MARKET_SETTINGS } from "@engine";
import { authErrorFrom } from "./auth/authGateway";
import { createLocalRepository } from "./local/localRepository";
import { MemoryStorage } from "./local/memoryStorage";
import {
  CANT_REACH_SERVER,
  DEAL_CHANGED_ELSEWHERE,
  DEAL_DELETED_ELSEWHERE,
  SIGNED_OUT,
} from "./messages";
import { sampleDealInputs } from "./sample";
import { guardSession } from "./sessionGuard";
import { toDataError } from "./supabase/errors";
import { DataError } from "./types";

const failure = async (promise: Promise<unknown>): Promise<DataError> => {
  const caught = await promise.catch((error: unknown) => error);
  expect(caught).toBeInstanceOf(DataError);
  return caught as DataError;
};

describe("the owner-facing copy shared between modules", () => {
  it("says a deal changed or deleted elsewhere the same way in every repository", async () => {
    let clock = "2026-11-01T10:00:00.000Z";
    const repo = createLocalRepository(new MemoryStorage(), { now: () => clock });
    const deal = await repo.createDeal({ name: "Maple Street", inputs: sampleDealInputs() });
    clock = "2026-11-01T11:00:00.000Z";
    await repo.saveDeal(deal);
    expect((await failure(repo.saveDeal(deal))).message).toBe(DEAL_CHANGED_ELSEWHERE);
    await repo.deleteDeal(deal.id);
    expect((await failure(repo.saveDeal(deal))).message).toBe(DEAL_DELETED_ELSEWHERE);
  });

  it("says the server can't be reached the same way for data and for sign-in", () => {
    expect(toDataError(new TypeError("Failed to fetch"), "load").message).toBe(CANT_REACH_SERVER);
    expect(authErrorFrom(new TypeError("Failed to fetch")).message).toBe(CANT_REACH_SERVER);
  });

  it("says a session that ended is a sign-out, the same way wherever it is heard", async () => {
    expect(toDataError({ message: "JWT expired", code: "PGRST303" }, "load", undefined, 401).message).toBe(SIGNED_OUT);
    const { remote, end } = guardSession(createLocalRepository(new MemoryStorage()));
    end();
    expect((await failure(remote.getMarketSettings(DEFAULT_MARKET_SETTINGS.region))).message).toBe(SIGNED_OUT);
  });
});
