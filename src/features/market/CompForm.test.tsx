import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Comp } from "@engine";
import { sampleComps } from "../../data/sample";
import { CompForm } from "./CompForm";
import { formFromComp } from "./compForm";

const FIRST = sampleComps()[0] as Comp;

function renderForm(region: string) {
  const onSave = vi.fn();
  render(
    <CompForm
      mode="edit"
      initial={formFromComp(FIRST)}
      region={region}
      id={FIRST.id}
      saving={false}
      saveError={null}
      onSave={onSave}
      onCancel={() => {}}
    />,
  );
  return { onSave, form: screen.getByRole("form", { name: "Edit comp" }) };
}

describe("CompForm on its own", () => {
  it("hands a finished comp to onSave", async () => {
    const { onSave, form } = renderForm("utah-north");

    await userEvent.click(within(form).getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(FIRST);
  });

  it("says why when a problem belongs to no box, so a refused Save is never silent", async () => {
    // The region comes from the deal; a bad one cannot be put under any box of the form.
    const { onSave, form } = renderForm(undefined as unknown as string);
    expect(within(form).queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(within(form).getByRole("button", { name: "Save" }));

    const alert = within(form).getByRole("alert");
    expect(alert).toHaveTextContent(/^Couldn't save this comp: .*expected string/);
    expect(onSave).not.toHaveBeenCalled();
    // With no box to go to, focus goes to the message.
    expect(alert).toHaveFocus();
    expect(form.querySelector('[aria-invalid="true"]')).toBeNull();
  });
});
