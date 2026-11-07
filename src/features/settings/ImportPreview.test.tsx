import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ImportPlan } from "../../data/exportFile";
import { ImportPreview } from "./ImportPreview";

const plan = (over: Partial<ImportPlan> = {}): ImportPlan => ({
  comps: [],
  skippedComps: [],
  deals: [],
  skippedDeals: [],
  skippedPriceBook: 0,
  droppedSelections: 0,
  settings: null,
  ...over,
});

function show(p: ImportPlan, extra: Partial<Parameters<typeof ImportPreview>[0]> = {}) {
  const props = {
    replaceSettings: false,
    onReplaceSettingsChange: vi.fn(),
    running: false,
    onImport: vi.fn(),
    onCancel: vi.fn(),
    ...extra,
  };
  render(<ImportPreview plan={p} {...props} />);
  return props;
}

describe("ImportPreview", () => {
  it("shows counts, every skip with its reason, and the price-book note", () => {
    show(
      plan({
        deals: [{ name: "A", status: "analyzing" as const, inputs: {} as never }],
        skippedDeals: [{ name: "Old", reason: "already in your account" }],
        skippedComps: [{ address: "1 Main St", reason: "already in your account" }],
        skippedPriceBook: 2,
        droppedSelections: 1,
      }),
    );
    expect(screen.getByText("1 deal and 0 comps will be imported.")).toBeVisible();
    expect(screen.getByText('Deal "Old": already in your account')).toBeVisible();
    expect(screen.getByText("Comp 1 Main St: already in your account")).toBeVisible();
    expect(screen.getByText("2 price overrides: price overrides come in with the cost book screen")).toBeVisible();
    expect(screen.getByText(/1 comp choice points at a comp that isn't in the file or your account/)).toBeVisible();
  });

  it("runs Import, disables it while running, and offers Cancel", async () => {
    const props = show(plan({ deals: [{ name: "A", status: "analyzing" as const, inputs: {} as never }] }));
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(props.onImport).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables Import while running and when there is nothing to do", () => {
    show(plan({ deals: [{ name: "A", status: "analyzing" as const, inputs: {} as never }] }), {
      running: true,
    });
    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
  });

  it("disables Import when nothing would change", () => {
    show(plan());
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("reports the settings checkbox", async () => {
    const props = show(plan());
    await userEvent.click(screen.getByRole("checkbox", { name: "Also replace my settings" }));
    expect(props.onReplaceSettingsChange).toHaveBeenCalledWith(true);
  });
});
