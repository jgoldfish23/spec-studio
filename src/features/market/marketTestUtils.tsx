import { testSampleComps } from "../../testing/sampleIds";
// Shared set-up for the market page's tests (not a test itself).
import { fireEvent, screen, within } from "@testing-library/react";
import type { Comp, DomEstimate, PriceEstimate } from "@engine";

import type { StoredDeal } from "../../data/types";
import { pasteOver } from "../../testing/editorTiming";
import type { User } from "../../testing/editorTiming";
import { evaluated } from "../../testing/engineContext";
import { renderApp } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";

export async function openMarket(harness: Harness, deal: StoredDeal) {
  renderApp(`#/deals/${deal.id}/market`, harness);
  await screen.findByRole("region", { name: "Comps" });
}

export const card = (name: string) => screen.getByRole("region", { name });
/** The comps table. Its name says it is ranked unless the deal could not be scored, when it is just "Comps". */
export const compsTable = (name = "Comps ranked by match") => screen.getByRole("table", { name });

/** The row of a comp, found by its address. */
export function compRow(address: string): HTMLElement {
  const row = within(compsTable()).getByText(address).closest("tr");
  if (row === null) throw new Error(`no row for ${address}`);
  return row;
}

/** The addresses of the table's rows, top to bottom: the first line of each row's header cell. */
export function listedAddresses(tableName?: string): string[] {
  const rows = within(compsTable(tableName)).getAllByRole("row").slice(1);
  return rows.map((row) => within(row).getByRole("rowheader").firstElementChild?.textContent ?? "");
}

/** The tile of a label in the summary strip under the deal's name. */
export const summaryTile = (label: string) =>
  within(screen.getByRole("region", { name: "Deal summary" })).getByText(label).closest("dl") as HTMLElement;

/** The engine's price estimate for the sample deal and comps. */
export async function samplePrice(): Promise<PriceEstimate> {
  const { price } = await evaluated();
  if (price.status !== "ok") throw new Error("the sample has no price estimate");
  return price.value;
}

/** The engine's days-on-market estimate for the sample deal and comps. */
export async function sampleDom(): Promise<DomEstimate> {
  const { dom } = await evaluated();
  if (dom.status !== "ok") throw new Error("the sample has no days-on-market estimate");
  return dom.value;
}

/** The sample's comps in the engine's order, best match first. */
export async function sampleScored() {
  return (await evaluated()).scoredComps;
}

/** A sold comp far from the sample deal: another county, older and smaller, so it scores under the threshold. */
export function farComp(change: Partial<Comp> = {}): Comp {
  return {
    ...(testSampleComps()[0] as Comp),
    id: "2f5b9d3a-0d7e-4a52-8d51-0c6c5f4f7a10",
    source: "manual",
    address: "9 Far Street, Ogden, UT",
    city: "Ogden",
    county: "Weber",
    listDate: "2024-01-10",
    soldDate: "2024-03-10",
    listPriceCents: 60_000_000,
    soldPriceCents: 60_000_000,
    aboveGradeFinishedSf: 1500,
    basementFinishedSf: 0,
    yearBuilt: 2005,
    newConstruction: false,
    garageBays: 2,
    basementFinish: "none",
    ...change,
  };
}

/** A complete, valid comp for the form, with the label of each box. */
export const NEW_COMP_BOXES: Record<string, string> = {
  Address: "12 Oak Lane, Kaysville, UT",
  City: "Kaysville",
  "List date": "2026-07-10",
  "Sold date": "2026-09-20",
  "Sold price": "1,360,000",
  "Above-grade finished sf": "2,200",
  "Basement finished sf": "1,800",
  "Unfinished sf": "0",
  Beds: "5",
  Baths: "4",
  "Year built": "2025",
  "Lot acres": "0.3",
  "Garage bays": "3",
};

const DATE_BOXES = new Set(["List date", "Contract date", "Sold date"]);

/** Types `boxes` (label to text) into the form. A date box is set the way the browser's picker sets it. */
export async function fillBoxes(user: User, form: HTMLElement, boxes: Record<string, string>) {
  for (const [label, text] of Object.entries(boxes)) {
    if (DATE_BOXES.has(label)) fireEvent.change(within(form).getByLabelText(label), { target: { value: text } });
    else await pasteOver(user, label, text, form);
  }
}
