import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function setup() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <>
      <button type="button">Opener</button>
      <ConfirmDialog message="Delete Sample? This can't be undone." confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />
    </>,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("is a modal alert dialog labelled by its message, with Cancel and a confirm button", () => {
    setup();
    const dialog = screen.getByRole("alertdialog", { name: "Delete Sample? This can't be undone." });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
  });

  it("moves focus to Cancel when it opens", () => {
    setup();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("confirms with the confirm button, once", async () => {
    const { onConfirm, onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels with the Cancel button", async () => {
    const { onConfirm, onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels on Escape", async () => {
    const { onConfirm, onCancel } = setup();
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the dialog", async () => {
    setup();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete" });
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it("gives focus back to what had it before, when it closes", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <ConfirmDialog message="Sure?" confirmLabel="Yes" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe("ConfirmDialog extra action", () => {
  it("runs the extra action without closing, keeps Tab inside, and shows the note", async () => {
    const onExtra = vi.fn();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        message="Remove all?"
        confirmLabel="Remove all"
        onConfirm={onConfirm}
        onCancel={onCancel}
        extraAction={{ label: "Download a copy first", onClick: onExtra }}
        note="Downloaded."
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Download a copy first" }));
    expect(onExtra).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Downloaded.");
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Remove all" })).toHaveFocus();
  });
});
