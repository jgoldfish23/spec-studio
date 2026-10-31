import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { compDomDays, DEFAULT_MARKET_SETTINGS } from "@engine";
import { sampleComps } from "../../data/sample";
import { formatMoney } from "../../lib/format";
import { advance, installFakeClock, newUser, savedAfterAutosave } from "../../testing/editorTiming";
import { evaluated } from "../../testing/engineContext";
import {
  card,
  compRow,
  compsTable,
  farComp,
  harnessOver,
  listedAddresses,
  openMarket,
  sampleScored,
  samplePrice,
  sampleSetup,
  setupWith,
} from "./marketTestUtils";

installFakeClock();

const TOP = "Sample comp 1, Kaysville, UT";

const midPrice = () => within(card("Sale price estimate")).getByText("Mid · base").closest("dl") as HTMLElement;

describe("the comps table", () => {
  it("has the columns of the mockup, then the comp's actions", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);

    const headers = within(compsTable()).getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).toEqual([
      "Comp",
      "Built",
      "Fin. sf",
      "Sold price",
      "$ / fin sf",
      "Days to contract",
      "Listed → sold",
      "Match",
      "Adjusted value",
      "Use",
      "Actions",
    ]);
  });

  it("lists every comp of the library, best match first", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const scored = await sampleScored();

    expect(listedAddresses()).toEqual(scored.map(({ comp }) => comp.address));
    expect(listedAddresses()).toHaveLength(8);
    expect(listedAddresses()[0]).toBe(TOP);
  });

  it("shows a comp's facts in its row", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const price = await samplePrice();
    const implied = price.comps.find((comp) => comp.id === "comp-1")?.impliedCents;

    const cells = within(compRow(TOP)).getAllByRole("cell");
    expect(within(compRow(TOP)).getByRole("rowheader")).toHaveTextContent(`${TOP}Kaysville`);
    // Built, finished sf (2,173 above grade and 1,777 in the basement), sold price, price per finished sf.
    expect(cells.slice(0, 4).map((cell) => cell.textContent)).toEqual(["2025", "3,950", "$1,365,000", "$346"]);
    // Days to contract, listed → sold, match, adjusted value.
    expect(cells[4]).toHaveTextContent(String(compDomDays(sampleComps()[0]!, DEFAULT_MARKET_SETTINGS)));
    expect(cells[4]).toHaveTextContent("26");
    expect(cells[5]).toHaveTextContent("Apr 2026 → Jun 2026");
    expect(cells[6]).toHaveTextContent("98%");
    expect(cells[7]).toHaveTextContent(formatMoney(implied));
    expect(cells[7]).toHaveTextContent("$1,333,381");
    expect(within(cells[8] as HTMLElement).getByRole("button", { name: "Included" })).toBeVisible();
  });

  it("rounds the match score to a whole number for every row", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const scored = await sampleScored();

    for (const { comp, score } of scored) {
      expect(within(compRow(comp.address)).getByText(`${Math.round(score)}%`)).toBeVisible();
    }
  });

  it("uses the engine's adjusted value for each included comp, and a dash for one that is left out", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.compSelections["comp-8"] = false;
    });
    await openMarket(harness, deal);
    const evaluation = await evaluated((await harness.repository.getDeal(deal.id))!.inputs);
    if (evaluation.price.status !== "ok") throw new Error("no price");
    const { comps: used } = evaluation.price.value;

    for (const { comp } of evaluation.scoredComps) {
      const implied = used.find((entry) => entry.id === comp.id)?.impliedCents;
      const cell = within(compRow(comp.address)).getAllByRole("cell")[7] as HTMLElement;
      expect(cell).toHaveTextContent(implied === undefined ? /^—$/ : formatMoney(implied));
    }
    expect(used.some((entry) => entry.id === "comp-8")).toBe(false);
  });

  it("shows a dash for days to contract when a comp has no list date", async () => {
    const { harness, deal } = await sampleSetup();
    const noList = farComp();
    delete noList.listDate;
    await harness.repository.saveComp(noList);
    await openMarket(harness, deal);

    const cells = within(compRow(noList.address)).getAllByRole("cell");
    expect(cells[4]).toHaveTextContent(/^—$/);
    // Only the side that is missing is a dash.
    expect(cells[5]).toHaveTextContent("— → Mar 2024");
  });

  it("shows a dash for the price per sf and the sold price of a comp that has not sold", async () => {
    const { harness, deal } = await sampleSetup();
    const active = farComp({ status: "active", id: "9d1c6b7e-2b6a-4c0e-8d63-5f0a1a2b3c4d", address: "5 Listing Lane, Layton, UT" });
    delete active.soldDate;
    delete active.soldPriceCents;
    await harness.repository.saveComp(active);
    await openMarket(harness, deal);

    const cells = within(compRow(active.address)).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent(/^—$/);
    expect(cells[3]).toHaveTextContent(/^—$/);
    expect(cells[5]).toHaveTextContent("Jan 2024 → —");
  });

  it("sits inside a box that scrolls sideways, so the page does not", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);

    expect(compsTable().closest(".overflow-x-auto")).not.toBeNull();
  });

  it("says so when the library has no comps", async () => {
    const { harness, deal } = await sampleSetup();
    for (const comp of await harness.repository.listComps("utah-north")) await harness.repository.deleteComp(comp.id);
    await openMarket(harness, deal);

    expect(within(card("Comps")).getByText("No comps yet. Add the first one to get a market estimate.")).toBeVisible();
    expect(screen.queryByRole("table", { name: "Comps ranked by match" })).not.toBeInTheDocument();
  });

  it("offers the two imports as disabled buttons tagged Later, and Add comp as a live one", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);

    const comps = card("Comps");
    for (const name of ["Import spreadsheet", "Import file"]) {
      const button = within(comps).getByRole("button", { name: new RegExp(name) });
      expect(button).toBeDisabled();
      expect(within(button).getByText("Later")).toBeVisible();
    }
    expect(within(comps).getByRole("button", { name: "Add comp" })).toBeEnabled();
  });
});

describe("choosing which comps count", () => {
  it("excludes the top comp: the mid price moves and the deal stores false for its id", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();
    const before = await samplePrice();
    expect(midPrice()).toHaveTextContent(formatMoney(before.midCents));

    await user.click(within(compRow(TOP)).getByRole("button", { name: "Included" }));
    await advance(200);

    expect(within(compRow(TOP)).getByRole("button", { name: "Excluded" })).toBeVisible();
    const inputs = (await harness.repository.getDeal(deal.id))!.inputs;
    const expected = await evaluated({ ...inputs, compSelections: { "comp-1": false } });
    if (expected.price.status !== "ok") throw new Error("no price");
    expect(expected.price.value.midCents).not.toBe(before.midCents);
    expect(midPrice()).toHaveTextContent(formatMoney(expected.price.value.midCents));
    expect(midPrice()).not.toHaveTextContent(formatMoney(before.midCents));

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.compSelections["comp-1"]).toBe(false);
    expect(stored.compSelections).toEqual({ "comp-1": false });
  });

  it("drops the excluded comp from the price's comps count and from its adjusted value", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);

    await newUser().click(within(compRow(TOP)).getByRole("button", { name: "Included" }));
    await advance(200);

    expect(within(card("Sale price estimate")).getByText("Based on 7 comps")).toBeVisible();
    expect(within(compRow(TOP)).getAllByRole("cell")[7]).toHaveTextContent(/^—$/);
  });

  it("includes a comp the automatic rule left out, and stores true for its id", async () => {
    const { harness, deal } = await sampleSetup();
    const far = farComp();
    await harness.repository.saveComp(far);
    await openMarket(harness, deal);
    const user = newUser();
    const row = compRow(far.address);
    expect(within(row).getByRole("button", { name: "Excluded" })).toBeVisible();
    expect(within(row).queryByRole("button", { name: "Reset to automatic" })).not.toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Excluded" }));
    await advance(200);

    expect(within(compRow(far.address)).getByRole("button", { name: "Included" })).toBeVisible();
    expect(within(card("Sale price estimate")).getByText("Based on 9 comps")).toBeVisible();
    expect((await savedAfterAutosave(harness, deal)).compSelections).toEqual({ [far.id]: true });
  });

  it("offers Reset to automatic only on a row with a choice, and removes the key when it is used", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();
    const before = await samplePrice();
    expect(screen.queryByRole("button", { name: "Reset to automatic" })).not.toBeInTheDocument();

    await user.click(within(compRow(TOP)).getByRole("button", { name: "Included" }));
    await advance(200);
    expect(screen.getAllByRole("button", { name: "Reset to automatic" })).toHaveLength(1);
    expect(within(compRow(TOP)).getByRole("button", { name: "Reset to automatic" })).toBeVisible();

    await user.click(within(compRow(TOP)).getByRole("button", { name: "Reset to automatic" }));
    await advance(200);

    expect(screen.queryByRole("button", { name: "Reset to automatic" })).not.toBeInTheDocument();
    expect(within(compRow(TOP)).getByRole("button", { name: "Included" })).toBeVisible();
    expect(midPrice()).toHaveTextContent(formatMoney(before.midCents));
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.compSelections).toEqual({});
    expect("comp-1" in stored.compSelections).toBe(false);
  });

  it("shows Reset to automatic for a choice that happens to agree with the automatic rule", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.compSelections["comp-1"] = true;
    });
    await openMarket(harness, deal);

    expect(within(compRow(TOP)).getByRole("button", { name: "Reset to automatic" })).toBeVisible();
    expect(within(compRow(TOP)).getByRole("button", { name: "Included" })).toBeVisible();
  });

  it("flips a stored choice to its opposite", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.compSelections["comp-8"] = false;
    });
    await openMarket(harness, deal);
    const address = "Sample comp 8, Layton, UT";
    expect(within(compRow(address)).getByRole("button", { name: "Excluded" })).toBeVisible();

    await newUser().click(within(compRow(address)).getByRole("button", { name: "Excluded" }));
    await advance(200);

    expect((await savedAfterAutosave(harness, deal)).compSelections).toEqual({ "comp-8": true });
  });

  it("can be undone from the header", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();

    await user.click(within(compRow(TOP)).getByRole("button", { name: "Included" }));
    await advance(200);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await advance(200);

    expect(within(compRow(TOP)).getByRole("button", { name: "Included" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reset to automatic" })).not.toBeInTheDocument();
  });
});

describe("deleting a comp", () => {
  const TARGET = "Sample comp 8, Layton, UT";

  it("asks first, and keeps the comp when the answer is Cancel", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();

    await user.click(within(compRow(TARGET)).getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: `Delete ${TARGET}? This can't be undone.` });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(listedAddresses()).toHaveLength(8);
    expect(await harness.repository.listComps("utah-north")).toHaveLength(8);
    // Focus goes back to the button that asked.
    expect(within(compRow(TARGET)).getByRole("button", { name: "Delete" })).toHaveFocus();
  });

  it("deletes the comp from the library and its row from the table", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();

    await user.click(within(compRow(TARGET)).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(listedAddresses()).toHaveLength(7));
    expect(listedAddresses()).not.toContain(TARGET);
    const library = await harness.repository.listComps("utah-north");
    expect(library.map((comp) => comp.id)).not.toContain("comp-8");
    expect(library).toHaveLength(7);
    expect(within(card("Sale price estimate")).getByText("Based on 7 comps")).toBeVisible();
  });

  it("removes the deal's choice for that comp, so no key is left behind", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.compSelections["comp-8"] = false;
      inputs.compSelections["comp-1"] = false;
    });
    await openMarket(harness, deal);
    const user = newUser();

    await user.click(within(compRow(TARGET)).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(listedAddresses()).toHaveLength(7));
    await advance(200);

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.compSelections).toEqual({ "comp-1": false });
  });

  it("puts focus back in the comps card once the row it was on is gone", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();

    await user.click(within(compRow(TARGET)).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(listedAddresses()).toHaveLength(7));

    expect(document.activeElement).not.toBe(document.body);
    expect(card("Comps").contains(document.activeElement)).toBe(true);
  });

  it("says so, and keeps the comp, when the library cannot delete it", async () => {
    const { harness: base, deal } = await sampleSetup();
    const failing = harnessOver(base, {
      ...base.repository,
      deleteComp: async () => {
        throw new Error("storage is blocked");
      },
    });
    await openMarket(failing, deal);
    const user = newUser();

    await user.click(within(compRow(TARGET)).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(`Couldn't delete ${TARGET}: storage is blocked`);
    expect(listedAddresses()).toHaveLength(8);
  });
});
