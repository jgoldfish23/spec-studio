import { within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { openSettings, card } from "./settingsTestUtils";

beforeEach(() => {
  window.location.hash = "";
});

describe("Quantity rules", () => {
  it("lists the engine's rules read-only, with a note", async () => {
    await openSettings();
    const rules = within(card("Quantity rules"));
    expect(rules.getByText("Read-only for now.")).toBeVisible();
    const table = rules.getByRole("table", { name: "Quantity rules" });
    const row = within(table)
      .getByRole("rowheader", { name: /Sf per bay/ })
      .closest("tr")!;
    expect(within(row).getByRole("cell")).toHaveTextContent("256");
    expect(rules.queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: /Sf per acre/ })).toBeVisible();
  });
});
