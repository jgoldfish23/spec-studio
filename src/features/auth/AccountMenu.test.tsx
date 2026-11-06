import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountMenu } from "./AccountMenu";

const USER = { id: "u-1", email: "pat@example.com" };

function setup(pendingCount = 0) {
  const onSignOut = vi.fn();
  render(
    <AccountMenu
      user={USER}
      pendingCount={pendingCount}
      onSignOut={onSignOut}
    />,
  );
  return { onSignOut };
}

const open = () =>
  userEvent.click(screen.getByRole("button", { name: /pat@example.com/ }));

describe("AccountMenu", () => {
  it("is closed until opened, then shows the email and Sign out", async () => {
    setup();
    const trigger = screen.getByRole("button", { name: /pat@example.com/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
    await open();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(screen.getAllByText("pat@example.com").length).toBeGreaterThan(1);
  });

  it("closes on Escape, returning focus to the button, and on an outside click", async () => {
    setup();
    await open();
    await userEvent.keyboard("{Escape}");
    const trigger = screen.getByRole("button", { name: /pat@example.com/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    await open();
    await userEvent.click(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("signs out at once with nothing pending", async () => {
    const { onSignOut } = setup(0);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("asks first with changes pending, and signs out only on confirm", async () => {
    const { onSignOut } = setup(2);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      screen.getByRole("alertdialog", {
        name: "2 changes haven't synced yet. Sign out anyway? They stay on this device and sync the next time you sign in here.",
      }),
    ).toBeInTheDocument();
    expect(onSignOut).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSignOut).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Sign out",
      }),
    );
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("says '1 change hasn't' for one", async () => {
    setup(1);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(
      /^1 change hasn't synced yet\./,
    );
  });
});
