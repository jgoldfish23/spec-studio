import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompSchema } from "@engine";
import type { Comp } from "@engine";
import { DataError } from "../../data/types";
import { advance, installFakeClock, newUser, pasteOver } from "../../testing/editorTiming";
import { harnessOver, sampleSetup } from "../../testing/stepHarness";
import { card, compRow, fillBoxes, listedAddresses, NEW_COMP_BOXES, openMarket } from "./marketTestUtils";

installFakeClock();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NEW_ADDRESS = NEW_COMP_BOXES.Address as string;

const addForm = () => screen.getByRole("form", { name: "Add comp" });
const addButton = () => within(card("Comps")).getByRole("button", { name: "Add comp" });
/** The message shown under a box (not its hint); empty when there is none. */
const fieldMessage = (form: HTMLElement, label: string) => {
  const ids = (within(form).getByLabelText(label).getAttribute("aria-describedby") ?? "").split(" ");
  return ids
    .filter((id) => id.endsWith("-message"))
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
};

/** Opens the Market page and the add form on the sample deal. */
async function openAdd() {
  const { harness, deal } = await sampleSetup();
  await openMarket(harness, deal);
  const user = newUser();
  await user.click(addButton());
  return { harness, deal, user, form: addForm() };
}

/** What the library holds, by address. */
async function stored(harness: Awaited<ReturnType<typeof sampleSetup>>["harness"], address: string): Promise<Comp | undefined> {
  return (await harness.repository.listComps("utah-north")).find((comp) => comp.address === address);
}

describe("opening and closing the form", () => {
  it("opens an inline form with the focus in Address and the deal's county filled in", async () => {
    const { form } = await openAdd();

    expect(within(form).getByLabelText("Address")).toHaveFocus();
    expect(within(form).getByLabelText("County")).toHaveValue("Davis");
    for (const label of [
      "City",
      "List date",
      "Contract date",
      "Sold date",
      "Sold price",
      "List price",
      "Above-grade finished sf",
      "Basement finished sf",
      "Unfinished sf",
      "Beds",
      "Baths",
      "Year built",
      "Lot acres",
      "Garage bays",
    ]) {
      expect(within(form).getByLabelText(label)).toHaveValue("");
    }
    // The form is inside the Comps card, above the table.
    expect(card("Comps")).toContainElement(form);
  });

  it("marks the two optional boxes and says what a blank list price means", async () => {
    const { form } = await openAdd();

    expect(within(form).getByText("Optional")).toBeVisible();
    expect(within(form).getByText("Optional · defaults to the sold price")).toBeVisible();
  });

  it("has the basement finish choice, with None chosen, and the three feature boxes unchecked", async () => {
    const { form } = await openAdd();

    const finish = within(form).getByRole("group", { name: "Basement finish" });
    expect(within(finish).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "None",
      "Unfinished",
      "Partial",
      "Finished",
    ]);
    expect(within(finish).getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
    for (const name of ["Walkout", "ADU", "Pool"]) expect(within(form).getByRole("checkbox", { name })).not.toBeChecked();
  });

  it("closes on Cancel without saving, and puts focus back on Add comp", async () => {
    const { harness, user, form } = await openAdd();

    await fillBoxes(user, form, { Address: "Half typed", City: "Layton" });
    await user.click(within(form).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(addButton()).toHaveFocus();
    expect(await harness.repository.listComps("utah-north")).toHaveLength(8);
    expect(listedAddresses()).toHaveLength(8);
  });

  it("closes on Escape, with focus back on Add comp", async () => {
    const { user } = await openAdd();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(addButton()).toHaveFocus();
  });

  it("keeps what was typed when Add comp is pressed again, and goes back to Address", async () => {
    const { user, form } = await openAdd();
    await fillBoxes(user, form, { Address: "Half typed", City: "Layton" });

    await user.click(addButton());

    expect(screen.getAllByRole("form")).toHaveLength(1);
    expect(within(addForm()).getByLabelText("Address")).toHaveValue("Half typed");
    expect(within(addForm()).getByLabelText("City")).toHaveValue("Layton");
    expect(within(addForm()).getByLabelText("Address")).toHaveFocus();
  });

  it("opens one form at a time: Edit on a row replaces the add form", async () => {
    const { user } = await openAdd();

    await user.click(within(compRow("Sample comp 3, Fruit Heights, UT")).getByRole("button", { name: "Edit" }));

    expect(screen.getAllByRole("form")).toHaveLength(1);
    expect(screen.getByRole("form", { name: "Edit comp" })).toBeVisible();
  });
});

describe("saving a new comp", () => {
  it("shows no message until Save is tried", async () => {
    const { form, user } = await openAdd();

    await fillBoxes(user, form, { City: "Layton" });
    expect(within(form).queryByText("Required")).not.toBeInTheDocument();
    expect(within(form).queryByText("Enter the sold price")).not.toBeInTheDocument();
    expect(within(form).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("without a sold price, says so next to the field, saves nothing and moves focus there", async () => {
    const { harness, form, user } = await openAdd();
    const withoutSoldPrice = { ...NEW_COMP_BOXES };
    delete withoutSoldPrice["Sold price"];
    await fillBoxes(user, form, withoutSoldPrice);

    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(fieldMessage(form, "Sold price")).toBe("Enter the sold price");
    expect(within(form).getByLabelText("Sold price")).toHaveAttribute("aria-invalid", "true");
    expect(within(form).getByLabelText("Sold price")).toHaveFocus();
    expect(screen.getByRole("form", { name: "Add comp" })).toBeVisible();
    expect(await harness.repository.listComps("utah-north")).toHaveLength(8);
    expect(listedAddresses()).toHaveLength(8);
    // The other boxes, which are fine, have nothing to say.
    expect(within(form).getByLabelText("Address")).not.toHaveAttribute("aria-invalid");
  });

  it("asks for every required box at once, and moves focus to the first", async () => {
    const { harness, form, user } = await openAdd();

    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(fieldMessage(form, "Address")).toBe("Required");
    expect(fieldMessage(form, "City")).toBe("Required");
    expect(fieldMessage(form, "List date")).toBe("Required");
    expect(fieldMessage(form, "Sold date")).toBe("Required");
    expect(fieldMessage(form, "Above-grade finished sf")).toBe("Required");
    expect(fieldMessage(form, "Year built")).toBe("Required");
    expect(fieldMessage(form, "Lot acres")).toBe("Required");
    expect(fieldMessage(form, "Garage bays")).toBe("Required");
    expect(fieldMessage(form, "Sold price")).toBe("Enter the sold price");
    // The county is filled in from the deal, so it has nothing to say until it is emptied.
    expect(fieldMessage(form, "County")).toBe("");
    // The boxes that do not feed the match or the price may stay blank.
    for (const label of ["Beds", "Baths", "Basement finished sf", "Unfinished sf"]) expect(fieldMessage(form, label)).toBe("");
    expect(within(form).getByLabelText("Address")).toHaveFocus();
    expect(await harness.repository.listComps("utah-north")).toHaveLength(8);
  });

  it("asks for the county when it is emptied, and says what a blank bed, bath, basement or unfinished box means", async () => {
    const { harness, form, user } = await openAdd();
    await fillBoxes(user, form, { ...NEW_COMP_BOXES, County: "" });
    await user.clear(within(form).getByLabelText("County"));

    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(fieldMessage(form, "County")).toBe("Required");
    expect(within(form).getByLabelText("County")).toHaveFocus();
    expect(within(form).getByText("A blank bed, bath, basement or unfinished box counts as 0.")).toBeVisible();
    expect(await harness.repository.listComps("utah-north")).toHaveLength(8);
  });

  it("takes a message away as soon as its box is put right", async () => {
    const { form, user } = await openAdd();
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(fieldMessage(form, "City")).toBe("Required");

    await pasteOver(user, "City", "Layton", form);

    expect(fieldMessage(form, "City")).toBe("");
    expect(within(form).getByLabelText("City")).not.toHaveAttribute("aria-invalid");
  });

  it("adds one row and one to the comps count when the comp is complete", async () => {
    const { harness, form, user } = await openAdd();
    expect(within(card("Sale price estimate")).getByText("Based on 8 comps")).toBeVisible();
    await fillBoxes(user, form, NEW_COMP_BOXES);

    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(listedAddresses()).toHaveLength(9));
    expect(listedAddresses()).toContain(NEW_ADDRESS);
    expect(within(card("Sale price estimate")).getByText("Based on 9 comps")).toBeVisible();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(within(compRow(NEW_ADDRESS)).getByRole("button", { name: "Included" })).toBeVisible();
    expect(await harness.repository.listComps("utah-north")).toHaveLength(9);
  });

  it("puts focus back on Add comp after saving", async () => {
    const { form, user } = await openAdd();
    await fillBoxes(user, form, NEW_COMP_BOXES);

    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());

    expect(addButton()).toHaveFocus();
  });

  it("stores a sold, manual, verified comp in the deal's region, with a uuid and no null anywhere", async () => {
    const { harness, form, user } = await openAdd();
    await fillBoxes(user, form, NEW_COMP_BOXES);
    await user.click(within(form).getByRole("button", { name: "Partial" }));
    await user.click(within(form).getByRole("checkbox", { name: "Walkout" }));

    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(listedAddresses()).toHaveLength(9));

    const comp = await stored(harness, NEW_ADDRESS);
    expect(comp).toBeDefined();
    expect(comp?.id).toMatch(UUID);
    expect(CompSchema.safeParse(comp).success).toBe(true);
    expect(comp).toEqual({
      id: comp?.id,
      address: NEW_ADDRESS,
      city: "Kaysville",
      county: "Davis",
      region: "utah-north",
      status: "sold",
      listDate: "2026-07-10",
      listPriceCents: 136_000_000,
      soldDate: "2026-09-20",
      soldPriceCents: 136_000_000,
      aboveGradeFinishedSf: 2200,
      basementFinishedSf: 1800,
      unfinishedSf: 0,
      beds: 5,
      baths: 4,
      yearBuilt: 2025,
      newConstruction: true,
      lotAcres: 0.3,
      garageBays: 3,
      basementFinish: "partial",
      walkout: true,
      adu: false,
      pool: false,
      source: "manual",
      verified: true,
    });
    expect(Object.values(comp as Comp).every((value) => value !== null && value !== undefined)).toBe(true);
  });

  it("marks a house that sold more than three years after it was built as not new construction", async () => {
    const { harness, form, user } = await openAdd();
    await fillBoxes(user, form, { ...NEW_COMP_BOXES, "Year built": "2015" });

    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(listedAddresses()).toHaveLength(9));

    expect((await stored(harness, NEW_ADDRESS))?.newConstruction).toBe(false);
  });

  it("uses a typed list price and a contract date, and the sold price when the list price is blank", async () => {
    const { harness, form, user } = await openAdd();
    await fillBoxes(user, form, { ...NEW_COMP_BOXES, "List price": "1,399,000", "Contract date": "2026-08-15" });

    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(listedAddresses()).toHaveLength(9));

    expect(await stored(harness, NEW_ADDRESS)).toMatchObject({
      listPriceCents: 139_900_000,
      soldPriceCents: 136_000_000,
      contractDate: "2026-08-15",
    });
    // Days to contract now run from the list date to the contract date: 36 days.
    expect(within(compRow(NEW_ADDRESS)).getAllByRole("cell")[4]).toHaveTextContent("36");
  });

  it("puts a sold date before the list date at the Sold date, and saves nothing", async () => {
    const { harness, form, user } = await openAdd();
    await fillBoxes(user, form, { ...NEW_COMP_BOXES, "List date": "2026-09-20", "Sold date": "2026-07-10" });

    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(fieldMessage(form, "Sold date")).toBe("Sold date is before the list date");
    expect(within(form).getByLabelText("Sold date")).toHaveFocus();
    expect(fieldMessage(form, "List date")).toBe("");
    expect(await harness.repository.listComps("utah-north")).toHaveLength(8);
  });

  it("shows the schema's message next to the box it is about", async () => {
    const { form, user } = await openAdd();
    await fillBoxes(user, form, { ...NEW_COMP_BOXES, "Year built": "1700", "Garage bays": "2.5" });

    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(fieldMessage(form, "Year built")).toBe("Must be 1800 or more");
    expect(fieldMessage(form, "Garage bays")).toBe("Enter a whole number");
  });

  it("does not touch the deal: nothing to undo, and no choice stored for the new comp", async () => {
    const { harness, deal, form, user } = await openAdd();
    await fillBoxes(user, form, NEW_COMP_BOXES);

    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(listedAddresses()).toHaveLength(9));
    await advance(1200);

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect((await harness.repository.getDeal(deal.id))?.inputs.compSelections).toEqual({});
  });

  it("says why when the library cannot save, keeps the form and what was typed, and saves again when asked", async () => {
    const { harness: base, deal } = await sampleSetup();
    let failures = 1;
    const flaky = harnessOver(base, {
      ...base.repository,
      saveComp: async (comp) => {
        if (failures-- > 0) throw new DataError("Couldn't save — browser storage is full");
        return base.repository.saveComp(comp);
      },
    });
    await openMarket(flaky, deal);
    const user = newUser();
    await user.click(addButton());
    const form = addForm();
    await fillBoxes(user, form, NEW_COMP_BOXES);

    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("Couldn't save the comp: browser storage is full");
    expect(within(form).getByLabelText("Address")).toHaveValue(NEW_ADDRESS);
    expect(within(form).getByRole("button", { name: "Save" })).toBeEnabled();
    expect(listedAddresses()).toHaveLength(8);

    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(listedAddresses()).toHaveLength(9));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});

describe("editing a comp", () => {
  const ADDRESS = "Sample comp 3, Fruit Heights, UT";

  async function openEdit() {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();
    await user.click(within(compRow(ADDRESS)).getByRole("button", { name: "Edit" }));
    return { harness, deal, user, form: screen.getByRole("form", { name: "Edit comp" }) };
  }

  it("opens the form filled in with the comp, and the focus in Address", async () => {
    const { form } = await openEdit();

    expect(within(form).getByLabelText("Address")).toHaveValue(ADDRESS);
    expect(within(form).getByLabelText("Address")).toHaveFocus();
    expect(within(form).getByLabelText("City")).toHaveValue("Fruit Heights");
    expect(within(form).getByLabelText("County")).toHaveValue("Davis");
    expect(within(form).getByLabelText("List date")).toHaveValue("2026-05-15");
    expect(within(form).getByLabelText("Contract date")).toHaveValue("");
    expect(within(form).getByLabelText("Sold date")).toHaveValue("2026-07-15");
    expect(within(form).getByLabelText("Sold price")).toHaveValue("1,425,000");
    expect(within(form).getByLabelText("List price")).toHaveValue("1,425,000");
    expect(within(form).getByLabelText("Above-grade finished sf")).toHaveValue("2,255");
    expect(within(form).getByLabelText("Basement finished sf")).toHaveValue("1,845");
    expect(within(form).getByLabelText("Year built")).toHaveValue("2025");
    expect(within(form).getByRole("button", { name: "Partial" })).toHaveAttribute("aria-pressed", "true");
  });

  it("replaces the comp in place when saved: same id, no new row, the new figure shown", async () => {
    const { harness, form, user } = await openEdit();
    const before = await stored(harness, ADDRESS);

    await pasteOver(user, "Sold price", "1,450,000", form);
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());

    expect(listedAddresses()).toHaveLength(8);
    expect(within(compRow(ADDRESS)).getAllByRole("cell")[2]).toHaveTextContent("$1,450,000");
    const after = await stored(harness, ADDRESS);
    expect(after?.id).toBe(before?.id);
    expect(after).toEqual({ ...before, soldPriceCents: 145_000_000 });
    expect(await harness.repository.listComps("utah-north")).toHaveLength(8);
  });

  it("brings focus back to the row's Edit button when saved and when cancelled", async () => {
    const { form, user } = await openEdit();
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(within(compRow(ADDRESS)).getByRole("button", { name: "Edit" })).toHaveFocus();

    await user.click(within(compRow(ADDRESS)).getByRole("button", { name: "Edit" }));
    await user.click(within(screen.getByRole("form", { name: "Edit comp" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());

    expect(within(compRow(ADDRESS)).getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("keeps the facts the form has no box for", async () => {
    const { harness, deal } = await sampleSetup();
    const original = (await stored(harness, ADDRESS)) as Comp;
    await harness.repository.saveComp({ ...original, notes: "Corner lot", priceCuts: 2, originalListPriceCents: 150_000_000 });
    await openMarket(harness, deal);
    const user = newUser();

    await user.click(within(compRow(ADDRESS)).getByRole("button", { name: "Edit" }));
    await pasteOver(user, "Beds", "6", screen.getByRole("form", { name: "Edit comp" }));
    await user.click(within(screen.getByRole("form", { name: "Edit comp" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());

    expect(await stored(harness, ADDRESS)).toMatchObject({
      beds: 6,
      notes: "Corner lot",
      priceCuts: 2,
      originalListPriceCents: 150_000_000,
    });
  });

  it("keeps the source, the verified flag and the status of a comp that was not entered by hand", async () => {
    const { harness, deal } = await sampleSetup();
    const original = (await stored(harness, ADDRESS)) as Comp;
    await harness.repository.saveComp({ ...original, source: "csv", verified: false, status: "pending" });
    await openMarket(harness, deal);
    const user = newUser();

    await user.click(within(compRow(ADDRESS)).getByRole("button", { name: "Edit" }));
    await pasteOver(user, "Beds", "6", screen.getByRole("form", { name: "Edit comp" }));
    await user.click(within(screen.getByRole("form", { name: "Edit comp" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());

    expect(await stored(harness, ADDRESS)).toEqual({
      ...original,
      beds: 6,
      source: "csv",
      verified: false,
      status: "pending",
    });
  });

  it("closes the form when the comp it is open on is deleted", async () => {
    const { user } = await openEdit();

    await user.click(within(compRow(ADDRESS)).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(listedAddresses()).toHaveLength(7));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});
