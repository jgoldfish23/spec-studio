import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "./local/memoryStorage";
import { createLocalRepository } from "./local/localRepository";
import { sampleDealInputs } from "./sample";
import { guardSession } from "./sessionGuard";
import { DataError } from "./types";
import type { Repository } from "./types";

describe("guardSession", () => {
  it("passes every call through while the session lasts", async () => {
    const server = createLocalRepository(new MemoryStorage());
    const created = await server.createDeal({
      name: "Maple Street",
      inputs: sampleDealInputs(),
    });
    const { remote } = guardSession(server);
    expect((await remote.getDeal(created.id))?.name).toBe("Maple Street");
    const saved = await remote.saveDeal({ ...created, name: "Oak Hollow" });
    expect(saved.name).toBe("Oak Hollow");
    expect((await remote.listDeals()).deals.map((d) => d.name)).toEqual([
      "Oak Hollow",
    ]);
  });

  it("covers every method of the repository", () => {
    const server = createLocalRepository(new MemoryStorage());
    const { remote } = guardSession(server);
    expect(Object.keys(remote).sort()).toEqual(Object.keys(server).sort());
  });

  it("once ended, refuses every call as signed out, without reaching the server", async () => {
    const server = createLocalRepository(new MemoryStorage());
    const created = await server.createDeal({
      name: "Maple Street",
      inputs: sampleDealInputs(),
    });
    const save = vi.spyOn(server, "saveDeal");
    const list = vi.spyOn(server, "listComps");
    const { remote, end } = guardSession(server);
    end();

    const refused = await remote
      .saveDeal({ ...created, name: "Oak Hollow" })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(DataError);
    expect((refused as DataError).kind).toBe("signedOut");
    await expect(remote.listComps("utah-north")).rejects.toMatchObject({
      kind: "signedOut",
    });
    expect(save).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect((await server.getDeal(created.id))?.name).toBe("Maple Street");
  });

  it("lets a call already on its way finish", async () => {
    let answer!: (deals: Awaited<ReturnType<Repository["listDeals"]>>) => void;
    const server = {
      ...createLocalRepository(new MemoryStorage()),
      listDeals: () => new Promise((resolve) => (answer = resolve)),
    } as Repository;
    const { remote, end } = guardSession(server);
    const listing = remote.listDeals();
    end();
    answer({ deals: [], problems: [] });
    await expect(listing).resolves.toEqual({ deals: [], problems: [] });
  });
});
