import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Bid } from "@engine";
import { installFakeClock, newUser } from "../../testing/editorTiming";
import { BidForm } from "./BidForm";

installFakeClock();

const EXISTING: Bid = { code: "roofing", amountCents: 2_400_000, vendor: "Summit Roofing", receivedOn: "2026-09-15", notes: "Metal" };

function setup(bid?: Bid) {
  const onSave = vi.fn<(bid: Bid) => void>();
  const onCancel = vi.fn<() => void>();
  render(<BidForm code="roofing" codeName="Roofing" bid={bid} onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel, user: newUser() };
}

describe("BidForm", () => {
  it("is titled with the line's name, and says Add or Edit by whether there is a bid", () => {
    const { unmount } = render(<BidForm code="roofing" codeName="Roofing" onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("form", { name: "Add bid for Roofing" })).toBeVisible();
    unmount();
    render(<BidForm code="roofing" codeName="Roofing" bid={EXISTING} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("form", { name: "Edit bid for Roofing" })).toBeVisible();
  });

  it("starts empty, with the received date at today, and focus on the vendor", () => {
    setup();
    expect(screen.getByLabelText("Vendor")).toHaveValue("");
    expect(screen.getByLabelText("Vendor")).toHaveFocus();
    expect(screen.getByLabelText("Amount")).toHaveValue("");
    expect(screen.getByLabelText("Received")).toHaveValue("2026-10-31");
    expect(screen.getByLabelText("Notes")).toHaveValue("");
  });

  it("starts from the bid it is given", () => {
    setup(EXISTING);
    expect(screen.getByLabelText("Vendor")).toHaveValue("Summit Roofing");
    expect(screen.getByLabelText("Amount")).toHaveValue("24,000.00");
    expect(screen.getByLabelText("Received")).toHaveValue("2026-09-15");
    expect(screen.getByLabelText("Notes")).toHaveValue("Metal");
  });

  it("shows no message until Save is tried", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText("Vendor"), "A");
    await user.clear(screen.getByLabelText("Vendor"));
    expect(screen.queryByText("Vendor is required")).not.toBeInTheDocument();
    expect(screen.queryByText("Enter an amount above $0")).not.toBeInTheDocument();
  });

  it("refuses a blank vendor and a missing amount, saying so under each box, and moves focus to the first", async () => {
    const { user, onSave } = setup();
    await user.type(screen.getByLabelText("Vendor"), "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Vendor is required")).toBeVisible();
    expect(screen.getByText("Enter an amount above $0")).toBeVisible();
    expect(screen.getByLabelText("Vendor")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Amount")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Vendor")).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses an amount of zero", async () => {
    const { user, onSave } = setup();
    await user.type(screen.getByLabelText("Vendor"), "Summit");
    await user.type(screen.getByLabelText("Amount"), "0");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Enter an amount above $0")).toBeVisible();
    expect(screen.getByLabelText("Amount")).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears a message as soon as its box is fixed", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Vendor is required")).toBeVisible();

    await user.type(screen.getByLabelText("Vendor"), "Summit");
    expect(screen.queryByText("Vendor is required")).not.toBeInTheDocument();
    expect(screen.getByText("Enter an amount above $0")).toBeVisible();
  });

  it("refuses an amount above the $100 million ceiling, with the box's own message", async () => {
    const { user, onSave } = setup();
    await user.type(screen.getByLabelText("Vendor"), "Summit");
    await user.type(screen.getByLabelText("Amount"), "100000001");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Must be at most $100,000,000.00")).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses a date the engine would refuse, in the engine's words", async () => {
    const { user, onSave } = setup();
    await user.type(screen.getByLabelText("Vendor"), "Summit");
    await user.type(screen.getByLabelText("Amount"), "5000");
    // A two-digit year typed into the date box is stored as year 0026.
    await user.clear(screen.getByLabelText("Received"));
    await user.type(screen.getByLabelText("Received"), "0026-10-31");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Year must be 1900 or later")).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves the bid with the vendor trimmed, the amount in cents, the date, and no notes key when the notes are blank", async () => {
    const { user, onSave } = setup();
    await user.type(screen.getByLabelText("Vendor"), "  Wasatch Roofing ");
    await user.type(screen.getByLabelText("Amount"), "30,000");
    await user.type(screen.getByLabelText("Notes"), "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0];
    expect(saved).toEqual({ code: "roofing", amountCents: 3_000_000, vendor: "Wasatch Roofing", receivedOn: "2026-10-31" });
    expect(saved).not.toHaveProperty("notes");
  });

  it("saves the notes, trimmed", async () => {
    const { user, onSave } = setup();
    await user.type(screen.getByLabelText("Vendor"), "Wasatch");
    await user.type(screen.getByLabelText("Amount"), "100.25");
    await user.type(screen.getByLabelText("Notes"), "  Includes tear-off ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave.mock.calls[0]?.[0]).toEqual({
      code: "roofing",
      amountCents: 10_025,
      vendor: "Wasatch",
      receivedOn: "2026-10-31",
      notes: "Includes tear-off",
    });
  });

  it("saves an edited bid under the same code, and drops the old notes when they are cleared", async () => {
    const { user, onSave } = setup(EXISTING);
    await user.clear(screen.getByLabelText("Notes"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave.mock.calls[0]?.[0]).toEqual({
      code: "roofing",
      amountCents: 2_400_000,
      vendor: "Summit Roofing",
      receivedOn: "2026-09-15",
    });
  });

  it("saves when Enter is pressed in a box", async () => {
    const { user, onSave } = setup(EXISTING);
    await user.type(screen.getByLabelText("Vendor"), "{Enter}");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("cancels with the Cancel button or the Escape key, saving nothing", async () => {
    const { user, onSave, onCancel } = setup(EXISTING);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.type(screen.getByLabelText("Vendor"), "{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps its buttons at least 44 px tall", () => {
    setup();
    for (const name of ["Save", "Cancel"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("min-h-11");
    }
  });
});
