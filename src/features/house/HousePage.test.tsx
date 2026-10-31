import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { evaluateDeal } from "@engine";
import type { DealEvaluation, DealInputs, FinishTier, ValidationIssue } from "@engine";
import { SAMPLE_DEAL_NAME, sampleDealInputs } from "../../data/sample";
import type { StoredDeal } from "../../data/types";
import { formatMoney } from "../../lib/format";
import { advance, installFakeClock, newUser, pasteOver, savedAfterAutosave } from "../../testing/editorTiming";
import { contextFor, evaluated } from "../../testing/engineContext";
import { createHarness, renderApp, seedSampleDeal } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";
import { DealEditorContext } from "../deal/DealEditorContext";
import { useDealEditor } from "../deal/useDealEditor";
import type { DealEditor } from "../deal/useDealEditor";
import { HousePage } from "./HousePage";
import { takeoffRows } from "./takeoff";

// Every run of the engine is counted but still answered by the real one, so a test can say how many runs an edit costs.
vi.mock("@engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@engine")>();
  return { ...actual, evaluateDeal: vi.fn(actual.evaluateDeal) };
});
const engineRuns = vi.mocked(evaluateDeal);

installFakeClock();

async function sampleSetup() {
  const harness = createHarness();
  const deal = await seedSampleDeal(harness.repository);
  return { harness, deal };
}

/** The sample deal with a change, stored as a deal of its own. */
async function setupWith(change: (inputs: DealInputs) => void) {
  const harness = createHarness();
  const sample = await seedSampleDeal(harness.repository);
  const inputs = structuredClone(sample.inputs);
  change(inputs);
  const deal = await harness.repository.createDeal({ name: "Changed", inputs });
  return { harness, deal };
}

async function openHouse(harness: Harness, deal: StoredDeal) {
  renderApp(`#/deals/${deal.id}/house`, harness);
  await screen.findByLabelText("Main finished sf");
}

const card = (name: string) => screen.getByRole("region", { name });
const group = (name: string, parent: HTMLElement = document.body) => within(parent).getByRole("group", { name });
const tierButton = (tier: string) => within(group("Finishes")).getByRole("button", { name: new RegExp(`^${tier}`) });
const perSf = (tier: string) => within(tierButton(tier)).getByText(/\/ fin sf$/).textContent ?? "";
const dollars = (text: string) => Number(/\$([\d,]+)/.exec(text)?.[1]?.replaceAll(",", ""));
const buildTotal = () => card("Build estimate").children[1]?.textContent;

/** What the engine says the estimate comes to for the sample deal at a house tier. */
async function estimateAt(harness: Harness, inputs: DealInputs, tier: FinishTier) {
  const copy = structuredClone(inputs);
  copy.house.finishes.houseTier = tier;
  const { estimate } = evaluateDeal(copy, await contextFor({ repository: harness.repository }));
  if (estimate.status !== "ok") throw new Error("the estimate is incomplete");
  return estimate.value;
}

describe("House page layout", () => {
  it("draws the six cards and the side panel, in the mockup's order", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Start from",
      "Size & levels",
      "Footprint, roof & rooms",
      "Exterior",
      "Finishes",
      "Extras & outside",
      "Build estimate",
      "Live takeoff",
    ]);
    expect(screen.getByRole("heading", { level: 1, name: "House" })).toBeInTheDocument();
  });

  it("offers three ways to start, with the plan library marked Later and disabled", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);

    const start = group("Start from", card("Start from"));
    expect(within(start).getByRole("button", { name: /^Describe it/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(start).getByRole("button", { name: /^Stock plan or drafter PDF/ })).toHaveAttribute("aria-pressed", "false");
    const library = within(start).getByRole("button", { name: /^Plan library/ });
    expect(library).toBeDisabled();
    expect(within(library).getByText("Later")).toBeVisible();
    expect(screen.queryByLabelText("Plan name/reference")).not.toBeInTheDocument();
  });

  it("shows the sample house in the fields", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);

    const size = card("Size & levels");
    expect(within(group("Style", size)).getByRole("button", { pressed: true })).toHaveTextContent("Rambler");
    expect(within(group("Style", size)).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Rambler",
      "Two-story",
      "Multi-level",
    ]);
    expect(within(size).getByLabelText("Main finished sf")).toHaveValue("2,200");
    expect(within(size).getByLabelText("Main unfinished sf")).toHaveValue("0");
    expect(within(size).getByLabelText("Main ceilings ft")).toHaveValue("10");
    expect(within(size).getByRole("checkbox", { name: "Upper level" })).not.toBeChecked();
    expect(within(size).queryByLabelText("Upper finished sf")).not.toBeInTheDocument();
    expect(within(size).getByRole("checkbox", { name: "Basement" })).toBeChecked();
    expect(within(size).getByLabelText("Total sf")).toHaveValue("2,200");
    expect(within(size).getByLabelText("Finished sf")).toHaveValue("1,600");
    expect(within(size).getByRole("checkbox", { name: "Walkout" })).not.toBeChecked();

    const footprint = card("Footprint, roof & rooms");
    expect(within(footprint).getByLabelText("Width ft")).toHaveValue("55");
    expect(within(footprint).getByLabelText("Depth ft")).toHaveValue("40");
    expect(within(group("Corners & jogs", footprint)).getByRole("button", { pressed: true })).toHaveTextContent("Moderate");
    expect(within(group("Corners & jogs", footprint)).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Simple box",
      "Moderate",
      "Complex",
    ]);
    expect(within(group("Roof style", footprint)).getByRole("button", { pressed: true })).toHaveTextContent("Hip");
    expect(within(footprint).getByLabelText("Pitch (/12)")).toHaveValue("6");
    expect(within(footprint).getByLabelText("Garage bays")).toHaveValue("3");
    expect(within(footprint).getByRole("checkbox", { name: "Tandem" })).not.toBeChecked();
    expect(within(footprint).getByRole("checkbox", { name: "RV bay" })).not.toBeChecked();
    expect(within(footprint).getByLabelText("Bedrooms")).toHaveValue("5");
    expect(within(footprint).getByLabelText("Full baths")).toHaveValue("3");
    expect(within(footprint).getByLabelText("Half baths")).toHaveValue("1");
    expect(within(footprint).getByLabelText("Fireplaces")).toHaveValue("1");

    const exterior = card("Exterior");
    expect(within(exterior).getByLabelText("Stone %")).toHaveValue("25");
    expect(within(exterior).getByLabelText("Stucco %")).toHaveValue("50");
    expect(within(exterior).getByLabelText("Board & batten %")).toHaveValue("25");
    expect(within(exterior).getByLabelText("Fiber cement %")).toHaveValue("0");
    expect(within(exterior).getByText("Total: 100%")).toBeVisible();

    expect(within(tierButton("Upgraded")).getByText(/fin sf$/)).toBeVisible();
    expect(tierButton("Upgraded")).toHaveAttribute("aria-pressed", "true");
    expect(tierButton("Standard")).toHaveAttribute("aria-pressed", "false");
    expect(tierButton("Luxury")).toHaveAttribute("aria-pressed", "false");
    const finishes = card("Finishes");
    const overrides: Record<string, string> = { Kitchen: "Luxury", "Primary bath": "Same as house", Basement: "Standard" };
    for (const [area, pressed] of Object.entries(overrides)) {
      const control = group(area, finishes);
      expect(within(control).getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Same as house",
        "Standard",
        "Upgraded",
        "Luxury",
      ]);
      expect(within(control).getByRole("button", { pressed: true })).toHaveTextContent(pressed);
    }

    const extras = card("Extras & outside");
    expect(within(group("ADU", extras)).getByRole("button", { pressed: true })).toHaveTextContent("None");
    expect(within(group("ADU", extras)).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "None",
      "Basement",
      "Detached",
    ]);
    expect(within(group("Pool", extras)).getByRole("button", { pressed: true })).toHaveTextContent("None");
    expect(within(group("Pool", extras)).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "None",
      "Fiberglass",
      "Gunite",
    ]);
    expect(within(extras).queryByLabelText("Spa")).not.toBeInTheDocument();
    expect(within(extras).getByLabelText("Covered patio sf")).toHaveValue("400");
    expect(within(extras).getByLabelText("Driveway & flatwork sf")).toHaveValue("1,500");
    expect(within(extras).getByLabelText("Fencing lf")).toHaveValue("240");
    expect(within(group("Landscaping tier", extras)).getByRole("button", { pressed: true })).toHaveTextContent("Upgraded");
  });

  it("shows the build estimate, the takeoff note and the way on", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);

    const upgraded = await estimateAt(harness, deal.inputs, "upgraded");
    const panel = card("Build estimate");
    expect(within(panel).getByText(formatMoney(upgraded.totalCents))).toBeVisible();
    expect(within(panel).getByText(`${formatMoney(upgraded.costPerFinishedSfCents)} per finished sf · Upgraded finishes`)).toBeVisible();
    // Nothing has been edited yet.
    expect(within(panel).queryByText(/Change from last edit/)).not.toBeInTheDocument();
    expect(within(panel).getByText(/^Sale price holds at \$/)).toBeVisible();

    expect(within(card("Live takeoff")).getByText("Phase 2: these come from your drawn floor plan.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Next: review the estimate →" })).toHaveAttribute(
      "href",
      `#/deals/${deal.id}/estimate`,
    );
  });

  it("opens with the stock plan's reference box for a deal that starts from a stock plan", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.house.source = "stockPlan";
      inputs.house.stockPlanRef = "Aspen 2200";
    });
    await openHouse(harness, deal);
    expect(screen.getByRole("button", { name: /^Stock plan or drafter PDF/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Plan name/reference")).toHaveValue("Aspen 2200");
  });
});

describe("Start from", () => {
  it("shows the plan reference box for a stock plan and stores the source and the reference", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);

    await user.click(screen.getByRole("button", { name: /^Stock plan or drafter PDF/ }));
    expect(screen.getByRole("button", { name: /^Stock plan or drafter PDF/ })).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByLabelText("Plan name/reference"), "Aspen 2200");

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.source).toBe("stockPlan");
    expect(stored.house.stockPlanRef).toBe("Aspen 2200");
  });

  it("hides the reference box again for Describe it, and drops the reference when the box is emptied", async () => {
    const user = newUser();
    const { harness, deal } = await setupWith((inputs) => {
      inputs.house.source = "stockPlan";
      inputs.house.stockPlanRef = "Aspen 2200";
    });
    await openHouse(harness, deal);

    await user.clear(screen.getByLabelText("Plan name/reference"));
    let stored = await savedAfterAutosave(harness, deal);
    expect("stockPlanRef" in stored.house).toBe(false);

    await user.click(screen.getByRole("button", { name: /^Describe it/ }));
    expect(screen.queryByLabelText("Plan name/reference")).not.toBeInTheDocument();
    stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.source).toBe("described");
  });

  it("does nothing for the disabled plan library", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    await user.click(screen.getByRole("button", { name: /^Plan library/ }));
    expect(screen.getByRole("button", { name: /^Describe it/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});

describe("Finishes", () => {
  it("raises the build estimate when Luxury is chosen, and presses the Luxury button", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const upgraded = await estimateAt(harness, deal.inputs, "upgraded");
    const luxury = await estimateAt(harness, deal.inputs, "luxury");
    expect(luxury.totalCents).toBeGreaterThan(upgraded.totalCents);
    expect(buildTotal()).toBe(formatMoney(upgraded.totalCents));

    await user.click(tierButton("Luxury"));
    // The button answers at once; the estimate follows the 150 ms quiet period.
    expect(tierButton("Luxury")).toHaveAttribute("aria-pressed", "true");
    expect(tierButton("Upgraded")).toHaveAttribute("aria-pressed", "false");
    expect(buildTotal()).toBe(formatMoney(upgraded.totalCents));
    await advance(200);

    expect(buildTotal()).toBe(formatMoney(luxury.totalCents));
    expect(within(card("Build estimate")).getByText(/Luxury finishes$/)).toBeVisible();
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.finishes.houseTier).toBe("luxury");
  });

  it("prices each tier per finished square foot: Standard costs less than Luxury, each as the engine says", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);

    for (const tier of ["standard", "upgraded", "luxury"] as const) {
      const expected = await estimateAt(harness, deal.inputs, tier);
      const name = `${tier[0]?.toUpperCase()}${tier.slice(1)}`;
      expect(perSf(name)).toBe(`${formatMoney(expected.costPerFinishedSfCents)} / fin sf`);
    }
    expect(dollars(perSf("Standard"))).toBeLessThan(dollars(perSf("Luxury")));
    expect(dollars(perSf("Standard"))).toBeLessThan(dollars(perSf("Upgraded")));
    expect(dollars(perSf("Upgraded"))).toBeLessThan(dollars(perSf("Luxury")));
  });

  it("keeps the three prices as they are when the tier changes, because they are the same three deals", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const before = ["Standard", "Upgraded", "Luxury"].map(perSf);

    await user.click(tierButton("Standard"));
    await advance(200);
    expect(["Standard", "Upgraded", "Luxury"].map(perSf)).toEqual(before);
  });

  it("moves the prices when something else about the house changes", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const before = perSf("Luxury");

    fireEvent.change(screen.getByLabelText("Covered patio sf"), { target: { value: "2,400" } });
    await advance(200);
    expect(perSf("Luxury")).not.toBe(before);
  });

  it("runs the engine three times for an evaluation (the editor's, and the two other tiers), and not at all in between", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    await advance(300);

    engineRuns.mockClear();
    // A burst of edits inside the quiet period is one evaluation.
    fireEvent.change(screen.getByLabelText("Bedrooms"), { target: { value: "6" } });
    await advance(50);
    fireEvent.change(screen.getByLabelText("Bedrooms"), { target: { value: "7" } });
    await advance(50);
    fireEvent.change(screen.getByLabelText("Bedrooms"), { target: { value: "8" } });
    await advance(100);
    expect(engineRuns).not.toHaveBeenCalled();
    await advance(100);
    expect(engineRuns).toHaveBeenCalledTimes(3);

    // The autosave, its status text and every draw that follows work out nothing more.
    engineRuns.mockClear();
    await advance(2000);
    expect(engineRuns).not.toHaveBeenCalled();
  });

  it("stores an override and removes it for Same as house", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const finishes = card("Finishes");

    await user.click(within(group("Primary bath", finishes)).getByRole("button", { name: "Standard" }));
    await user.click(within(group("Kitchen", finishes)).getByRole("button", { name: "Same as house" }));
    expect(within(group("Primary bath", finishes)).getByRole("button", { pressed: true })).toHaveTextContent("Standard");
    expect(within(group("Kitchen", finishes)).getByRole("button", { pressed: true })).toHaveTextContent("Same as house");

    const stored = await savedAfterAutosave(harness, deal);
    // The key is gone, not set to nothing.
    expect(stored.house.finishes.overrides).toEqual({ primaryBath: "standard", basement: "standard" });
    expect("kitchen" in stored.house.finishes.overrides).toBe(false);
  });

  it("moves the estimate when an override changes", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const before = buildTotal();

    await user.click(within(group("Kitchen", card("Finishes"))).getByRole("button", { name: "Standard" }));
    await advance(200);
    expect(buildTotal()).not.toBe(before);
  });
});

describe("Size & levels", () => {
  it("adds an upper level with its three fields, stores it, and removes it again", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const size = card("Size & levels");

    await user.click(within(size).getByRole("checkbox", { name: "Upper level" }));
    expect(within(size).getByLabelText("Upper finished sf")).toHaveValue("1,000");
    expect(within(size).getByLabelText("Upper unfinished sf")).toHaveValue("0");
    expect(within(size).getByLabelText("Upper ceilings ft")).toHaveValue("9");
    let stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.levels.upper).toEqual({ finishedSf: 1000, unfinishedSf: 0, ceilingFt: 9 });

    await user.click(within(size).getByRole("checkbox", { name: "Upper level" }));
    expect(within(size).queryByLabelText("Upper finished sf")).not.toBeInTheDocument();
    stored = await savedAfterAutosave(harness, deal);
    expect("upper" in stored.house.levels).toBe(false);
  });

  it("stores what is typed into the main level and the upper level", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const size = card("Size & levels");

    await pasteOver(user, "Main finished sf", "2,400", size);
    await pasteOver(user, "Main unfinished sf", "150", size);
    await pasteOver(user, "Main ceilings ft", "9", size);
    await user.click(within(size).getByRole("checkbox", { name: "Upper level" }));
    await pasteOver(user, "Upper finished sf", "1,200", size);
    await pasteOver(user, "Upper unfinished sf", "100", size);
    await pasteOver(user, "Upper ceilings ft", "8", size);
    await user.click(within(group("Style", size)).getByRole("button", { name: "Two-story" }));

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.levels.main).toEqual({ finishedSf: 2400, unfinishedSf: 150, ceilingFt: 9 });
    expect(stored.house.levels.upper).toEqual({ finishedSf: 1200, unfinishedSf: 100, ceilingFt: 8 });
    expect(stored.house.style).toBe("twoStory");
  });

  it("starts a new basement as big as the main level, unfinished and without a walkout", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const size = card("Size & levels");

    await user.click(within(size).getByRole("checkbox", { name: "Basement" }));
    expect(within(size).queryByLabelText("Total sf")).not.toBeInTheDocument();
    let stored = await savedAfterAutosave(harness, deal);
    expect("basement" in stored.house.levels).toBe(false);

    await user.click(within(size).getByRole("checkbox", { name: "Basement" }));
    expect(within(size).getByLabelText("Total sf")).toHaveValue("2,200");
    expect(within(size).getByLabelText("Finished sf")).toHaveValue("0");
    expect(within(size).getByRole("checkbox", { name: "Walkout" })).not.toBeChecked();

    await user.click(within(size).getByRole("checkbox", { name: "Walkout" }));
    await pasteOver(user, "Finished sf", "1,000", size);
    stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.levels.basement).toEqual({ totalSf: 2200, finishedSf: 1000, walkout: true });
  });

  it("starts a new basement at 0 sf when the main level has no whole-number size to copy", async () => {
    const user = newUser();
    const { harness, deal } = await setupWith((inputs) => {
      delete inputs.house.levels.basement;
      inputs.house.levels.main.finishedSf = 2200.5;
    });
    await openHouse(harness, deal);

    await user.click(screen.getByRole("checkbox", { name: "Basement" }));
    expect(screen.getByLabelText("Total sf")).toHaveValue("0");
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.levels.basement).toEqual({ totalSf: 0, finishedSf: 0, walkout: false });
  });

  it("undoes the whole switch of a level in one step", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    await user.click(screen.getByRole("checkbox", { name: "Upper level" }));
    expect(screen.getByLabelText("Upper finished sf")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByLabelText("Upper finished sf")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Upper level" })).not.toBeChecked();
  });
});

describe("Footprint, roof & rooms", () => {
  it("stores the footprint, the roof, the garage and the rooms", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const footprint = card("Footprint, roof & rooms");

    await pasteOver(user, "Width ft", "60", footprint);
    await pasteOver(user, "Depth ft", "42", footprint);
    await user.click(within(group("Corners & jogs", footprint)).getByRole("button", { name: "Complex" }));
    await user.click(within(group("Roof style", footprint)).getByRole("button", { name: "Gable" }));
    await pasteOver(user, "Pitch (/12)", "8", footprint);
    await pasteOver(user, "Garage bays", "4", footprint);
    await user.click(within(footprint).getByRole("checkbox", { name: "Tandem" }));
    await user.click(within(footprint).getByRole("checkbox", { name: "RV bay" }));
    await pasteOver(user, "Bedrooms", "4", footprint);
    await pasteOver(user, "Full baths", "2", footprint);
    await pasteOver(user, "Half baths", "2", footprint);
    await pasteOver(user, "Fireplaces", "2", footprint);

    const { house } = await savedAfterAutosave(harness, deal);
    expect(house.footprint).toEqual({ widthFt: 60, depthFt: 42, complexity: "complex" });
    expect(house.roof).toEqual({ style: "gable", pitchPer12: 8 });
    expect(house.garage).toEqual({ bays: 4, tandem: true, rvBay: true });
    expect(house.rooms).toEqual({ bedrooms: 4, fullBaths: 2, halfBaths: 2, fireplaces: 2 });
  });

  it("refuses a fraction or a number past the engine's limit for a count", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);

    await pasteOver(user, "Bedrooms", "2.5");
    expect(screen.getByText("Enter a number")).toBeVisible();
    await pasteOver(user, "Bedrooms", "21");
    expect(screen.getByText("Must be between 0 and 20")).toBeVisible();
    await pasteOver(user, "Garage bays", "11");
    expect(screen.getByText("Must be between 0 and 10")).toBeVisible();
    await pasteOver(user, "Width ft", "50,001");
    expect(screen.getByText("Must be between 0 ft and 50,000 ft")).toBeVisible();

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.rooms.bedrooms).toBe(5);
    expect(stored.house.garage.bays).toBe(3);
    expect(stored.house.footprint.widthFt).toBe(55);
  });
});

describe("Exterior", () => {
  it("stores whole percents, as typed", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const exterior = card("Exterior");

    await pasteOver(user, "Stone %", "20", exterior);
    await pasteOver(user, "Stucco %", "40", exterior);
    await pasteOver(user, "Board & batten %", "30", exterior);
    await pasteOver(user, "Fiber cement %", "10", exterior);
    expect(within(exterior).getByText("Total: 100%")).toBeVisible();

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.exterior).toEqual({ stonePct: 20, stuccoPct: 40, boardBattenPct: 30, fiberCementPct: 10 });
  });

  it("says at once when the total is not 100, and the verdict reads Needs info", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const exterior = card("Exterior");
    expect(screen.queryByText("Needs info")).not.toBeInTheDocument();

    await pasteOver(user, "Stone %", "30", exterior);
    // Typed 30 on 25 + 50 + 25: the live line speaks before the engine has looked.
    expect(within(exterior).getByText("Total: 105% — must add up to 100%")).toHaveClass("text-no-go");

    await pasteOver(user, "Stone %", "35", exterior);
    expect(within(exterior).getByText("Total: 110% — must add up to 100%")).toHaveClass("text-no-go");
    await advance(200);
    expect(screen.getByText("Needs info")).toBeVisible();
    // The engine's own message follows, and the takeoff cannot be worked out.
    expect(within(exterior).getByText("Exterior percentages must add up to 100 (they add up to 110)")).toBeVisible();
    expect(within(card("Live takeoff")).getByText("Fill in the house to see the takeoff.")).toBeVisible();
    expect(within(card("Build estimate")).getByText("—")).toBeVisible();

    // Back to 100: the line, the message and the verdict's need are gone.
    await pasteOver(user, "Stone %", "25", exterior);
    await advance(200);
    expect(within(exterior).getByText("Total: 100%")).toHaveClass("text-ink");
    expect(within(exterior).queryByText(/must add up to 100/)).not.toBeInTheDocument();
    expect(screen.queryByText("Needs info")).not.toBeInTheDocument();
  });

  it("draws the mix as a bar of four segments, each as wide as its share, hidden from assistive tech", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const exterior = card("Exterior");

    const segments = () => Array.from(exterior.querySelectorAll<HTMLElement>("[data-material]"));
    expect(segments().map((segment) => segment.dataset.material)).toEqual([
      "stonePct",
      "stuccoPct",
      "boardBattenPct",
      "fiberCementPct",
    ]);
    expect(segments().map((segment) => segment.style.width)).toEqual(["25%", "50%", "25%", "0%"]);
    expect(segments()[0]?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(segments().map((segment) => segment.style.backgroundColor)).toEqual([
      "rgb(140, 129, 116)",
      "rgb(228, 221, 208)",
      "rgb(51, 64, 58)",
      "rgb(111, 135, 150)",
    ]);

    // 50 + 50 + 25 + 0 = 125: the bar is still whole, and each segment is its share of it.
    await pasteOver(user, "Stone %", "50", exterior);
    expect(segments().map((segment) => segment.style.width)).toEqual(["40%", "40%", "20%", "0%"]);
  });

  it("shows the mix in words beside the bar", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const exterior = card("Exterior");
    for (const text of ["Stone 25%", "Stucco 50%", "Board & batten 25%", "Fiber cement 0%"]) {
      expect(within(exterior).getByText(text)).toBeInTheDocument();
    }
  });

  it("refuses a fraction or a number over 100", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    await pasteOver(user, "Stone %", "12.5");
    expect(screen.getByText("Enter a number")).toBeVisible();
    await pasteOver(user, "Stone %", "101");
    expect(screen.getByText("Must be between 0 % and 100 %")).toBeVisible();
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.exterior.stonePct).toBe(25);
  });
});

describe("Extras & outside", () => {
  it("shows the Spa and Heated toggles for Gunite, stores the pool, and the estimate gains a Pool line", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    // The estimate step is not built yet, so the editor is opened here with a window on its evaluation.
    const view = await openHosted(harness, deal);
    const poolLine = (evaluation: DealEvaluation | undefined) =>
      evaluation?.estimate.status === "ok" ? evaluation.estimate.value.lines.find((line) => line.code === "pool") : undefined;
    expect(poolLine(view.editor().evaluation)).toBeUndefined();
    expect(screen.queryByLabelText("Spa")).not.toBeInTheDocument();

    await user.click(within(group("Pool")).getByRole("button", { name: "Gunite" }));
    expect(screen.getByRole("checkbox", { name: "Spa" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Heated" })).not.toBeChecked();
    await advance(200);

    const line = poolLine(view.editor().evaluation);
    expect(line).toBeDefined();
    expect(line?.totalCents).toBeGreaterThan(0);
    expect(line?.parts.map((part) => part.variant)).toEqual(["gunite", "safety"]);

    await user.click(screen.getByRole("checkbox", { name: "Spa" }));
    await advance(200);
    expect(poolLine(view.editor().evaluation)?.parts.map((part) => part.variant)).toEqual(["gunite", "spa", "safety"]);
    expect(view.editor().inputs?.house.pool).toEqual({ type: "gunite", spa: true, heated: false });
  });

  it("stores the pool kind with its spa and heater, keeps them across kinds, and puts them away for None", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const pool = group("Pool");

    await user.click(within(pool).getByRole("button", { name: "Fiberglass" }));
    await user.click(screen.getByRole("checkbox", { name: "Heated" }));
    let stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.pool).toEqual({ type: "fiberglass", spa: false, heated: true });

    await user.click(within(pool).getByRole("button", { name: "Gunite" }));
    expect(screen.getByRole("checkbox", { name: "Heated" })).toBeChecked();
    stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.pool).toEqual({ type: "gunite", spa: false, heated: true });

    await user.click(within(pool).getByRole("button", { name: "None" }));
    expect(screen.queryByLabelText("Spa")).not.toBeInTheDocument();
    stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.pool).toEqual({ type: "none", spa: false, heated: false });

    // A pool chosen again starts clean.
    await user.click(within(pool).getByRole("button", { name: "Fiberglass" }));
    expect(screen.getByRole("checkbox", { name: "Heated" })).not.toBeChecked();
  });

  it("asks for the ADU's finished area, stores it, and drops it for None", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const extras = card("Extras & outside");
    expect(within(extras).queryByLabelText("Finished sf")).not.toBeInTheDocument();

    await user.click(within(group("ADU", extras)).getByRole("button", { name: "Detached" }));
    const finished = within(group("ADU details", extras)).getByLabelText("Finished sf");
    expect(finished).toHaveValue("");
    let stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.adu).toEqual({ type: "detached" });

    await pasteOver(user, "Finished sf", "600", group("ADU details", extras));
    await user.click(within(group("ADU", extras)).getByRole("button", { name: "Basement" }));
    expect(within(group("ADU details", extras)).getByLabelText("Finished sf")).toHaveValue("600");
    stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.adu).toEqual({ type: "basement", finishedSf: 600 });

    await user.click(within(group("ADU", extras)).getByRole("button", { name: "None" }));
    expect(within(extras).queryByLabelText("Finished sf")).not.toBeInTheDocument();
    stored = await savedAfterAutosave(harness, deal);
    expect(stored.house.adu).toEqual({ type: "none" });
  });

  it("says a basement ADU needs a basement, under the ADU control", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const extras = card("Extras & outside");

    await user.click(within(card("Size & levels")).getByRole("checkbox", { name: "Basement" }));
    await user.click(within(group("ADU", extras)).getByRole("button", { name: "Basement" }));
    await advance(200);

    expect(group("ADU", extras)).toHaveAccessibleDescription("A basement ADU requires a basement");
    expect(within(extras).getByText("A basement ADU requires a basement")).toHaveClass("text-no-go");
  });

  it("stores the outside work and the landscaping tier", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const extras = card("Extras & outside");

    await pasteOver(user, "Covered patio sf", "500", extras);
    await pasteOver(user, "Driveway & flatwork sf", "2,000", extras);
    await pasteOver(user, "Fencing lf", "300", extras);
    await user.click(within(group("Landscaping tier", extras)).getByRole("button", { name: "Luxury" }));

    const { house } = await savedAfterAutosave(harness, deal);
    expect(house.outside).toEqual({ coveredPatioSf: 500, flatworkSf: 2000, fenceLf: 300, landscapingTier: "luxury" });
  });
});

describe("Live takeoff", () => {
  it("lists every quantity with its label, value and unit, and the foundation in LF", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const takeoff = card("Live takeoff");

    const foundation = within(takeoff).getByText("Foundation");
    expect(foundation.tagName).toBe("DT");
    expect(within(foundation.parentElement as HTMLElement).getByText("214 LF")).toBeVisible();

    const { quantities } = await evaluated(deal.inputs);
    if (quantities.status !== "ok") throw new Error("the sample takeoff is incomplete");
    const rows = takeoffRows(quantities.value);
    expect(within(takeoff).getAllByRole("term").map((term) => term.textContent)).toEqual(rows.map((row) => row.label));
    expect(rows.length).toBeGreaterThanOrEqual(27);
    const finishedArea = within(takeoff).getByText("Finished area").parentElement as HTMLElement;
    expect(within(finishedArea).getByText("3,800 sf")).toBeVisible();
  });

  it("gives how each figure was worked out as the row's title and as text for a screen reader", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const takeoff = card("Live takeoff");

    const { quantities } = await evaluated(deal.inputs);
    if (quantities.status !== "ok") throw new Error("the sample takeoff is incomplete");
    const row = within(takeoff).getByText("Foundation").parentElement as HTMLElement;
    expect(row).toHaveAttribute("title", quantities.value.foundationLf.explain);
    const hidden = within(row).getByText(quantities.value.foundationLf.explain);
    expect(hidden).toHaveClass("sr-only");
    expect(row).toHaveTextContent(`214 LF${quantities.value.foundationLf.explain}`);
  });

  it("follows an edit to the house", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const takeoff = card("Live takeoff");
    expect(within(within(takeoff).getByText("Foundation").parentElement as HTMLElement).getByText("214 LF")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Width ft"), { target: { value: "65" } });
    await advance(60);
    expect(within(within(takeoff).getByText("Foundation").parentElement as HTMLElement).getByText("214 LF")).toBeVisible();
    await advance(140);
    // 2 x (65 + 40) = 210 LF around, x 1.125 for a moderate footprint
    expect(within(within(takeoff).getByText("Foundation").parentElement as HTMLElement).getByText("236 LF")).toBeVisible();
  });
});

describe("Change from last edit", () => {
  const change = () => within(card("Build estimate")).queryByText(/^Change from last edit/)?.textContent;

  it("shows the rise and the fall of the estimate, with the engine's minus sign, and 'no change'", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const upgraded = await estimateAt(harness, deal.inputs, "upgraded");
    const luxury = await estimateAt(harness, deal.inputs, "luxury");
    const standard = await estimateAt(harness, deal.inputs, "standard");
    expect(change()).toBeUndefined();

    await user.click(tierButton("Luxury"));
    await advance(200);
    expect(change()).toBe(`Change from last edit: +${formatMoney(luxury.totalCents - upgraded.totalCents)}`);

    await user.click(tierButton("Standard"));
    await advance(200);
    const drop = formatMoney(standard.totalCents - luxury.totalCents);
    expect(drop.startsWith("−$")).toBe(true);
    expect(change()).toBe(`Change from last edit: ${drop}`);

    // An edit that does not touch the estimate (a bedroom is not priced) changes nothing.
    await pasteOver(user, "Bedrooms", "6");
    await advance(200);
    expect(change()).toBe("Change from last edit: no change");
  });

  it("counts an undo as an edit", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const upgraded = await estimateAt(harness, deal.inputs, "upgraded");
    const luxury = await estimateAt(harness, deal.inputs, "luxury");

    await user.click(tierButton("Luxury"));
    await advance(200);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await advance(200);

    expect(buildTotal()).toBe(formatMoney(upgraded.totalCents));
    expect(change()).toBe(`Change from last edit: ${formatMoney(upgraded.totalCents - luxury.totalCents)}`);
    expect(change()).toMatch(/^Change from last edit: \u2212\$/);
  });

  it("measures a burst of edits as one: from before the burst", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const before = await estimateAt(harness, deal.inputs, "upgraded");
    const edited = structuredClone(deal.inputs);
    edited.house.outside.coveredPatioSf = 900;
    const { estimate } = evaluateDeal(edited, await contextFor({ repository: harness.repository }));
    if (estimate.status !== "ok") throw new Error("the estimate is incomplete");

    fireEvent.change(screen.getByLabelText("Covered patio sf"), { target: { value: "600" } });
    await advance(50);
    fireEvent.change(screen.getByLabelText("Covered patio sf"), { target: { value: "900" } });
    await advance(200);
    expect(change()).toBe(`Change from last edit: +${formatMoney(estimate.value.totalCents - before.totalCents)}`);
  });

  it("is hidden while the estimate cannot be worked out, and for the edit that brings it back", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const exterior = card("Exterior");

    await user.click(tierButton("Luxury"));
    await advance(200);
    expect(change()).toBeDefined();

    await pasteOver(user, "Stone %", "35", exterior);
    await advance(200);
    expect(change()).toBeUndefined();

    await pasteOver(user, "Stone %", "25", exterior);
    await advance(200);
    expect(change()).toBeUndefined();

    // The next edit has a total on both sides again.
    await user.click(tierButton("Standard"));
    await advance(200);
    expect(change()).toMatch(/^Change from last edit: −\$/);
  });
});

describe("Messages from the engine", () => {
  it("shows a rule that belongs to a box under that box", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);

    await pasteOver(user, "Finished sf", "2,300", card("Size & levels"));
    await advance(200);
    const finished = within(card("Size & levels")).getByLabelText("Finished sf");
    expect(finished).toHaveAttribute("aria-invalid", "true");
    expect(finished).toHaveAccessibleDescription(/Finished basement area \(2300 sf\) cannot exceed the basement total \(2200 sf\)/);
    expect(within(card("Size & levels")).getByLabelText("Total sf")).not.toHaveAttribute("aria-invalid");
  });

  it("shows the footprint rule once, under the width and depth", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    const footprint = card("Footprint, roof & rooms");

    await pasteOver(user, "Width ft", "20", footprint);
    await pasteOver(user, "Depth ft", "20", footprint);
    await advance(200);
    expect(within(footprint).getAllByText(/^Footprint \(400 sf\) must be at least half of the main level/)).toHaveLength(1);
    expect(within(footprint).getByLabelText("Width ft")).not.toHaveAttribute("aria-invalid");
  });

  it("opens a stored house with a value the engine refuses, and shows the message under its box", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.house.rooms.bedrooms = -1;
      inputs.house.levels.main.ceilingFt = -9;
    });
    await openHouse(harness, deal);

    const bedrooms = screen.getByLabelText("Bedrooms");
    expect(bedrooms).toHaveValue("-1");
    expect(bedrooms).toHaveAttribute("aria-invalid", "true");
    expect(bedrooms).toHaveAccessibleDescription("Must be 0 or more");
    expect(screen.getByLabelText("Main ceilings ft")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Needs info")).toBeVisible();
    expect(within(card("Live takeoff")).getByText("Fill in the house to see the takeoff.")).toBeVisible();
    // The page itself still draws: the previews and the estimate are dashes, not a crash.
    expect(perSf("Luxury")).toBe("— / fin sf");
  });
});

/**
 * The choice controls have no box of their own for a message, and few values that break a rule get past the data
 * layer, so these tests give the page an evaluation that reports the problem, to see where it is shown.
 */
describe("messages under the choice controls, and figures from unusable numbers", () => {
  async function renderWith(validation: ValidationIssue[], change: (inputs: DealInputs) => void = () => {}) {
    const inputs = sampleDealInputs();
    change(inputs);
    const context = await contextFor();
    const evaluation = { ...(await evaluated(inputs)), validation };
    const now = new Date().toISOString();
    const editor: DealEditor = {
      status: "ready",
      deal: { id: "deal-1", name: "Fake", status: "analyzing", inputs, createdAt: now, updatedAt: now },
      inputs,
      evaluatedInputs: inputs,
      evaluation,
      context,
      edit: vi.fn(),
      rename: () => true,
      undo: vi.fn(),
      redo: vi.fn(),
      discardChanges: vi.fn(),
      canUndo: false,
      canRedo: false,
      saveStatus: { kind: "saved" },
    };
    render(
      <MemoryRouter>
        <DealEditorContext.Provider value={editor}>
          <HousePage />
        </DealEditorContext.Provider>
      </MemoryRouter>,
    );
  }

  it.each([
    ["Style", "house.style"],
    ["Corners & jogs", "house.footprint.complexity"],
    ["Roof style", "house.roof.style"],
    ["Kitchen", "house.finishes.overrides.kitchen"],
    ["Primary bath", "house.finishes.overrides.primaryBath"],
    ["Basement", "house.finishes.overrides.basement"],
    ["ADU", "house.adu.type"],
    ["Pool", "house.pool.type"],
    ["Landscaping tier", "house.outside.landscapingTier"],
  ])("shows a problem with %s under that control and ties it to the group", async (name, path) => {
    await renderWith([{ path, message: `Problem with ${name}` }]);
    expect(screen.getAllByText(`Problem with ${name}`)).toHaveLength(1);
    const control = screen.getAllByRole("group", { name }).find((candidate) => candidate.hasAttribute("aria-describedby"));
    expect(control).toHaveAccessibleDescription(`Problem with ${name}`);
  });

  it("shows a problem with the house tier under the tier buttons", async () => {
    await renderWith([{ path: "house.finishes.houseTier", message: "Choose a tier" }]);
    expect(screen.getByText("Choose a tier")).toHaveClass("text-no-go");
  });

  it("shows the engine's message about the exterior as a whole, under the total", async () => {
    await renderWith([{ path: "house.exterior", message: "Mix must be 100" }]);
    expect(screen.getByText("Mix must be 100")).toHaveClass("text-no-go");
  });

  it("shows a message about one material only under that material, not again under the total", async () => {
    await renderWith([{ path: "house.exterior.stonePct", message: "Must be 100 or less" }]);
    expect(screen.getAllByText("Must be 100 or less")).toHaveLength(1);
    expect(screen.getByLabelText("Stone %")).toHaveAccessibleDescription("Whole percent Must be 100 or less");
  });

  it("counts a percent that is not a number as nothing in the bar, and shows a dash for the total", async () => {
    await renderWith([], (inputs) => {
      inputs.house.exterior.stonePct = Number.NaN;
    });
    const exterior = card("Exterior");
    expect(within(exterior).getByText("Total: —")).toBeVisible();
    expect(within(exterior).getByText("Stone —")).toBeVisible();
    const widths = Array.from(exterior.querySelectorAll<HTMLElement>("[data-material]")).map((segment) => segment.style.width);
    // Stucco 50 and board and batten 25 share the bar; the stone that is not a number takes no room.
    expect(widths[0]).toBe("0%");
    expect(Number.parseFloat(widths[1] ?? "")).toBeCloseTo(66.667, 2);
    expect(Number.parseFloat(widths[2] ?? "")).toBeCloseTo(33.333, 2);
    expect(widths[3]).toBe("0%");
  });

  it("shows no total and an empty bar when no percent is a usable number", async () => {
    await renderWith([], (inputs) => {
      const { exterior } = inputs.house;
      exterior.stonePct = Number.NaN;
      exterior.stuccoPct = Number.POSITIVE_INFINITY;
      exterior.boardBattenPct = -25;
      exterior.fiberCementPct = 0;
    });
    const exterior = card("Exterior");
    expect(within(exterior).getByText("Total: —")).toBeVisible();
    const widths = Array.from(exterior.querySelectorAll<HTMLElement>("[data-material]")).map((segment) => segment.style.width);
    expect(widths).toEqual(["0px", "0px", "0px", "0px"]);
  });

  it("shows a dash for each tier and for the estimate when the stored house cannot be priced", async () => {
    await renderWith([{ path: "house.rooms.bedrooms", message: "Must be 0 or more" }], (inputs) => {
      inputs.house.rooms.bedrooms = -1;
    });
    expect(perSf("Standard")).toBe("— / fin sf");
    expect(within(card("Build estimate")).getByText("—")).toBeVisible();
  });
});

/** The house page in an editor the test can look into. */
async function openHosted(harness: Harness, deal: StoredDeal) {
  let latest: DealEditor | undefined;
  function Host() {
    const editor = useDealEditor(deal.id);
    latest = editor;
    return (
      <MemoryRouter>
        <DealEditorContext.Provider value={editor}>
          <HousePage />
        </DealEditorContext.Provider>
      </MemoryRouter>
    );
  }
  render(<Host />, { wrapper: harness.Providers });
  await screen.findByLabelText("Main finished sf");
  return {
    editor: (): DealEditor => {
      if (latest === undefined) throw new Error("the editor has not drawn yet");
      return latest;
    },
  };
}

describe("House page in the app", () => {
  it("is the house step of the deal, named for the deal in the header", async () => {
    const { harness, deal } = await sampleSetup();
    await openHouse(harness, deal);
    expect(screen.getByLabelText("Deal name")).toHaveValue(SAMPLE_DEAL_NAME);
    expect(screen.getByRole("link", { name: /House/, current: "step" })).toBeInTheDocument();
  });
});
