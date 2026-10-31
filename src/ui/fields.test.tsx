import type { Cents } from "@engine";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  DateField,
  MoneyField,
  MonthField,
  NumberField,
  OptionalMoneyField,
  OptionalNumberField,
  PercentField,
  TextField,
  Toggle,
} from "./fields";

/** Every value a field handed to `onChange`, in order. */
const handedValues = (onChange: ReturnType<typeof vi.fn>): unknown[] => onChange.mock.calls.map(([v]) => v);

/** Replaces whatever is in the box with `text`, key by key. */
async function typeOver(label: string, text: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, text);
}

/** Replaces whatever is in the box with `text` as a single change, so no half-typed text passes through. */
async function pasteOver(label: string, text: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.paste(text);
}

describe("MoneyField", () => {
  it("shows an inline message for text that is not a dollar amount, and never calls onChange", async () => {
    const onChange = vi.fn();
    render(<MoneyField label="Lot price" valueCents={0} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Lot price"), "abc");
    expect(screen.getByText("Enter a dollar amount")).toBeInTheDocument();
    expect(screen.getByLabelText("Lot price")).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange with integer cents when the text parses", async () => {
    const onChange = vi.fn();
    render(<MoneyField label="Lot price" valueCents={0} onChange={onChange} />);
    await typeOver("Lot price", "1,350,000");
    expect(onChange).toHaveBeenLastCalledWith(135_000_000);
    for (const v of handedValues(onChange)) expect(Number.isInteger(v)).toBe(true);
    expect(screen.queryByText("Enter a dollar amount")).not.toBeInTheDocument();
  });

  it("never hands over a float or NaN while text passes through half-typed states", async () => {
    const onChange = vi.fn();
    render(<MoneyField label="Unit price" valueCents={0} onChange={onChange} allowCents />);
    await typeOver("Unit price", "$0.29 and 1e3");
    for (const v of handedValues(onChange)) {
      expect(typeof v).toBe("number");
      expect(Number.isSafeInteger(v)).toBe(true);
    }
    expect(handedValues(onChange)).toContain(29);
  });

  it("keeps what the user typed, and tidies it on blur", async () => {
    const user = userEvent.setup();
    render(<MoneyField label="Lot price" valueCents={0} onChange={() => {}} />);
    const input = screen.getByLabelText("Lot price");
    await user.clear(input);
    await user.type(input, "1350000");
    expect(input).toHaveValue("1350000");
    await user.tab();
    expect(input).toHaveValue("1,350,000");
  });

  it("keeps invalid text and its message on blur", async () => {
    const user = userEvent.setup();
    render(<MoneyField label="Lot price" valueCents={0} onChange={() => {}} />);
    const input = screen.getByLabelText("Lot price");
    await user.clear(input);
    await user.type(input, "abc");
    await user.tab();
    expect(input).toHaveValue("abc");
    expect(screen.getByText("Enter a dollar amount")).toBeInTheDocument();
  });

  it("shows the starting value with thousands separators", () => {
    render(<MoneyField label="Lot price" valueCents={135_000_000} onChange={() => {}} />);
    expect(screen.getByLabelText("Lot price")).toHaveValue("1,350,000");
  });

  it("reads and shows cents when allowCents is on", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MoneyField label="Unit price" valueCents={0} onChange={onChange} allowCents />);
    const input = screen.getByLabelText("Unit price");
    await user.clear(input);
    await user.type(input, "12.5");
    expect(onChange).toHaveBeenLastCalledWith(1250);
    await user.tab();
    expect(input).toHaveValue("12.50");
  });

  it("refuses cents when allowCents is off", async () => {
    const onChange = vi.fn();
    render(<MoneyField label="Lot price" valueCents={0} onChange={onChange} />);
    await pasteOver("Lot price", "100.50");
    expect(screen.getByText("Enter a dollar amount")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says when the amount is outside min and max, and does not call onChange", async () => {
    const onChange = vi.fn();
    render(<MoneyField label="Lot price" valueCents={0} onChange={onChange} min={0} max={500_000_000} />);
    await pasteOver("Lot price", "6,000,000");
    expect(screen.getByText("Must be between $0 and $5,000,000")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Lot price")).toHaveAttribute("aria-invalid", "true");
  });

  it("words a one-sided range", async () => {
    const { rerender } = render(<MoneyField label="Lot price" valueCents={0} onChange={() => {}} min={100_000} />);
    await pasteOver("Lot price", "5");
    expect(screen.getByText("Must be at least $1,000")).toBeInTheDocument();
    rerender(<MoneyField label="Lot price" valueCents={0} onChange={() => {}} max={100_000} />);
    await pasteOver("Lot price", "5000");
    expect(screen.getByText("Must be at most $1,000")).toBeInTheDocument();
  });

  it("clears the message once the text is back in range", async () => {
    const onChange = vi.fn();
    render(<MoneyField label="Lot price" valueCents={0} onChange={onChange} min={0} max={500_000_000} />);
    await pasteOver("Lot price", "6,000,000");
    expect(screen.getByText(/Must be between/)).toBeInTheDocument();
    await typeOver("Lot price", "4000000");
    expect(screen.queryByText(/Must be between/)).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(400_000_000);
  });

  it("replaces the text when the value changes from outside (undo)", () => {
    const { rerender } = render(<MoneyField label="Lot price" valueCents={135_000_000} onChange={() => {}} />);
    expect(screen.getByLabelText("Lot price")).toHaveValue("1,350,000");
    rerender(<MoneyField label="Lot price" valueCents={29_500_000} onChange={() => {}} />);
    expect(screen.getByLabelText("Lot price")).toHaveValue("295,000");
  });

  it("clears an inline message when the value is replaced from outside", async () => {
    const { rerender } = render(<MoneyField label="Lot price" valueCents={100} onChange={() => {}} />);
    await userEvent.type(screen.getByLabelText("Lot price"), "x");
    expect(screen.getByText("Enter a dollar amount")).toBeInTheDocument();
    rerender(<MoneyField label="Lot price" valueCents={29_500_000} onChange={() => {}} />);
    expect(screen.queryByText("Enter a dollar amount")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Lot price")).toHaveValue("295,000");
    expect(screen.getByLabelText("Lot price")).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the user's text when the new value is what that text already means", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MoneyField label="Lot price" valueCents={0} onChange={() => {}} />);
    const input = screen.getByLabelText("Lot price");
    await user.clear(input);
    await user.type(input, "1350000");
    rerender(<MoneyField label="Lot price" valueCents={135_000_000} onChange={() => {}} />);
    expect(input).toHaveValue("1350000");
  });

  it("shows an error from outside under the field and marks the input invalid", () => {
    render(<MoneyField label="Lot price" valueCents={0} onChange={() => {}} error="Must be more than the asking price" />);
    expect(screen.getByText("Must be more than the asking price")).toBeInTheDocument();
    expect(screen.getByLabelText("Lot price")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the inline message, not the outside one, while the text in the box is invalid", async () => {
    render(<MoneyField label="Lot price" valueCents={0} onChange={() => {}} error="From the engine" />);
    expect(screen.getByText("From the engine")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Lot price"), "abc");
    expect(screen.getByText("Enter a dollar amount")).toBeInTheDocument();
    expect(screen.queryByText("From the engine")).not.toBeInTheDocument();
  });

  it("links the hint and the message to the input", async () => {
    render(<MoneyField label="Lot price" valueCents={0} onChange={() => {}} hint="What you pay the seller" error="From the engine" />);
    const input = screen.getByLabelText("Lot price");
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(describedBy).toHaveLength(2);
    const text = describedBy.map((id) => document.getElementById(id)?.textContent);
    expect(text).toContain("What you pay the seller");
    expect(text).toContain("From the engine");
  });

  it("has no aria-describedby and is not invalid when there is nothing to say", () => {
    render(<MoneyField label="Lot price" valueCents={0} onChange={() => {}} />);
    const input = screen.getByLabelText("Lot price");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAttribute("inputmode", "decimal");
  });
});

describe("OptionalMoneyField", () => {
  it("calls onChange(undefined) when the text is cleared", async () => {
    const onChange = vi.fn();
    render(<OptionalMoneyField label="List price" valueCents={135_000_000} onChange={onChange} />);
    const input = screen.getByLabelText("List price");
    expect(input).toHaveValue("1,350,000");
    await userEvent.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByText("Enter a dollar amount")).not.toBeInTheDocument();
  });

  it("treats whitespace as empty", async () => {
    const onChange = vi.fn();
    render(<OptionalMoneyField label="List price" valueCents={undefined} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("List price"), "  ");
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("follows the money rules for any other text", async () => {
    const onChange = vi.fn();
    render(<OptionalMoneyField label="List price" valueCents={undefined} onChange={onChange} />);
    const input = screen.getByLabelText("List price");
    expect(input).toHaveValue("");
    await userEvent.type(input, "abc");
    expect(screen.getByText("Enter a dollar amount")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "1,350,000");
    expect(onChange).toHaveBeenLastCalledWith(135_000_000);
  });

  it("shows an empty box when the value goes back to undefined from outside", () => {
    const { rerender } = render(<OptionalMoneyField label="List price" valueCents={135_000_000} onChange={() => {}} />);
    rerender(<OptionalMoneyField label="List price" valueCents={undefined} onChange={() => {}} />);
    expect(screen.getByLabelText("List price")).toHaveValue("");
  });
});

describe("OptionalNumberField", () => {
  it("calls onChange(undefined) when the text is cleared, and shows no message", async () => {
    const onChange = vi.fn();
    render(<OptionalNumberField label="Frontage" value={95} onChange={onChange} />);
    const input = screen.getByLabelText("Frontage");
    expect(input).toHaveValue("95");
    await userEvent.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByText("Enter a number")).not.toBeInTheDocument();
  });

  it("treats whitespace as empty", async () => {
    const onChange = vi.fn();
    render(<OptionalNumberField label="Frontage" value={undefined} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Frontage"), "  ");
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("follows the number rules for any other text", async () => {
    const onChange = vi.fn();
    render(<OptionalNumberField label="Frontage" value={undefined} onChange={onChange} unit="ft" min={0} />);
    const input = screen.getByLabelText("Frontage");
    expect(input).toHaveValue("");
    await userEvent.type(input, "abc");
    expect(screen.getByText("Enter a number")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "-4");
    expect(screen.getByText("Must be at least 0 ft")).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    await userEvent.clear(input);
    await userEvent.type(input, "95.5");
    expect(onChange).toHaveBeenLastCalledWith(95.5);
  });

  it("refuses a fraction when it takes whole numbers, and keeps to its range", async () => {
    const onChange = vi.fn();
    render(<OptionalNumberField label="Base days" value={undefined} onChange={onChange} integer min={0} max={1095} />);
    const input = screen.getByLabelText("Base days");
    await userEvent.type(input, "2.5");
    expect(screen.getByText("Enter a number")).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "2000");
    expect(screen.getByText("Must be between 0 and 1,095")).toBeInTheDocument();
    expect(onChange.mock.calls.every(([v]) => v === undefined || (Number.isInteger(v) && v <= 1095))).toBe(true);
    await userEvent.clear(input);
    await userEvent.type(input, "120");
    expect(onChange).toHaveBeenLastCalledWith(120);
  });

  it("shows an empty box when the value goes back to undefined from outside", () => {
    const { rerender } = render(<OptionalNumberField label="Frontage" value={95} onChange={() => {}} />);
    rerender(<OptionalNumberField label="Frontage" value={undefined} onChange={() => {}} />);
    expect(screen.getByLabelText("Frontage")).toHaveValue("");
  });
});

describe("PercentField", () => {
  it("reads a typed percent as a decimal and shows it with the chosen digits on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PercentField label="Contingency" value={0} onChange={onChange} digits={2} />);
    const input = screen.getByLabelText("Contingency");
    await user.clear(input);
    await user.type(input, "9");
    expect(onChange).toHaveBeenLastCalledWith(0.09);
    await user.tab();
    expect(input).toHaveValue("9.00");
  });

  it("shows the starting value as a percent", () => {
    render(<PercentField label="Contingency" value={0.071} onChange={() => {}} />);
    expect(screen.getByLabelText("Contingency")).toHaveValue("7.10");
  });

  it("takes a trailing percent sign", async () => {
    const onChange = vi.fn();
    render(<PercentField label="Contingency" value={0} onChange={onChange} />);
    await typeOver("Contingency", "9.5%");
    expect(onChange).toHaveBeenLastCalledWith(0.095);
  });

  it("shows an inline message for text that is not a percent", async () => {
    const onChange = vi.fn();
    render(<PercentField label="Contingency" value={0} onChange={onChange} />);
    await typeOver("Contingency", "abc");
    expect(screen.getByText("Enter a percent")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says when the percent is outside min and max", async () => {
    const onChange = vi.fn();
    render(<PercentField label="Contingency" value={0.05} onChange={onChange} min={0} max={1} />);
    await pasteOver("Contingency", "150");
    expect(screen.getByText("Must be between 0% and 100%")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(1.5);
    await pasteOver("Contingency", "-5");
    expect(screen.getByText("Must be between 0% and 100%")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(-0.05);
  });

  it("writes bounds with the digits the field allows", async () => {
    render(<PercentField label="Rate" value={0.05} onChange={() => {}} min={0.0025} max={0.2} digits={2} />);
    await pasteOver("Rate", "50");
    expect(screen.getByText("Must be between 0.25% and 20%")).toBeInTheDocument();
  });

  it("keeps the typed text on blur when tidying would change the value that was sent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PercentField label="Contingency" value={0} onChange={onChange} />);
    const input = screen.getByLabelText("Contingency");
    await user.clear(input);
    await user.type(input, "7.125");
    expect(onChange).toHaveBeenLastCalledWith(0.07125);
    await user.tab();
    // Two digits would show 7.13, which is 0.0713, not the 0.07125 the deal now holds.
    expect(input).toHaveValue("7.125");
    expect(onChange).toHaveBeenLastCalledWith(0.07125);
  });

  it("shows a stored percent that needs more than its digits without rounding it", () => {
    render(<PercentField label="Interest rate" value={0.07125} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Interest rate")).toHaveValue("7.125");
  });

  it("still tidies text on blur when that changes nothing but the look", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PercentField label="Contingency" value={0} onChange={onChange} />);
    const input = screen.getByLabelText("Contingency");
    await user.clear(input);
    await user.type(input, "9.5");
    expect(onChange).toHaveBeenLastCalledWith(0.095);
    await user.tab();
    expect(input).toHaveValue("9.50");
    expect(onChange).toHaveBeenLastCalledWith(0.095);
  });

  it("replaces the text when the value changes from outside", () => {
    const { rerender } = render(<PercentField label="Contingency" value={0.05} onChange={() => {}} />);
    rerender(<PercentField label="Contingency" value={0.1} onChange={() => {}} />);
    expect(screen.getByLabelText("Contingency")).toHaveValue("10.00");
  });
});

describe("NumberField", () => {
  it("reads a typed number, with thousands separators", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField label="Finished area" value={0} onChange={onChange} unit="sf" integer />);
    const input = screen.getByLabelText("Finished area");
    await user.clear(input);
    await user.type(input, "3800");
    expect(onChange).toHaveBeenLastCalledWith(3800);
    await user.tab();
    expect(input).toHaveValue("3,800");
  });

  it("keeps the typed text on blur when tidying would change the value that was sent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField label="Ratio" value={0} onChange={onChange} />);
    const input = screen.getByLabelText("Ratio");
    // Seven decimals: the tidied text keeps six, which is a different number.
    await user.clear(input);
    await user.type(input, "1.2345678");
    expect(onChange).toHaveBeenLastCalledWith(1.2345678);
    await user.tab();
    expect(input).toHaveValue("1.2345678");
    // Within six decimals the tidied text is the same number, so it is tidied.
    await user.clear(input);
    await user.type(input, "1234.5");
    await user.tab();
    expect(input).toHaveValue("1,234.5");
    expect(onChange).toHaveBeenLastCalledWith(1234.5);
  });

  it("shows the unit next to the box", () => {
    render(<NumberField label="Finished area" value={3800} onChange={() => {}} unit="sf" />);
    expect(screen.getByText("sf")).toBeInTheDocument();
  });

  it("refuses a fraction when integer is on, and a decimal otherwise", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<NumberField label="Bedrooms" value={0} onChange={onChange} integer />);
    await typeOver("Bedrooms", "2.5");
    expect(screen.getByText("Enter a number")).toBeInTheDocument();
    expect(handedValues(onChange)).not.toContain(2.5);
    rerender(<NumberField label="Bedrooms" value={0} onChange={onChange} />);
    await typeOver("Bedrooms", "2.5");
    expect(onChange).toHaveBeenLastCalledWith(2.5);
  });

  it("shows an inline message for text that is not a number", async () => {
    const onChange = vi.fn();
    render(<NumberField label="Bedrooms" value={0} onChange={onChange} />);
    await typeOver("Bedrooms", "abc");
    expect(screen.getByText("Enter a number")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("writes the range in the field's own units", async () => {
    const onChange = vi.fn();
    render(<NumberField label="Finished area" value={3800} onChange={onChange} unit="sf" min={500} max={20000} integer />);
    await pasteOver("Finished area", "30,000");
    expect(screen.getByText("Must be between 500 sf and 20,000 sf")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("writes a range without a unit", async () => {
    render(<NumberField label="Floors" value={1} onChange={() => {}} min={1} max={3} integer />);
    await pasteOver("Floors", "4");
    expect(screen.getByText("Must be between 1 and 3")).toBeInTheDocument();
  });
});

describe("TextField", () => {
  it("is controlled and passes the text straight through", async () => {
    const onChange = vi.fn();
    render(<TextField label="Vendor" value="" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Vendor"), "A");
    expect(onChange).toHaveBeenCalledWith("A");
  });

  it("shows its value, a hint and an outside error", () => {
    render(<TextField label="Vendor" value="Wasatch Framing" onChange={() => {}} hint="Who sent the bid" error="Required" />);
    const input = screen.getByLabelText("Vendor");
    expect(input).toHaveValue("Wasatch Framing");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Who sent the bid")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("tells the caller when the box loses focus", async () => {
    const onBlur = vi.fn();
    render(<TextField label="Vendor" value="x" onChange={() => {}} onBlur={onBlur} />);
    await userEvent.click(screen.getByLabelText("Vendor"));
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("is a text box with the usual keyboard unless told otherwise", () => {
    render(<TextField label="Vendor" value="" onChange={() => {}} />);
    const input = screen.getByLabelText("Vendor");
    expect(input).toHaveAttribute("type", "text");
    expect(input).not.toHaveAttribute("inputmode");
  });

  it("can be a date box, which keeps an emptied value empty", () => {
    render(<TextField label="Contract date" type="date" value="2026-05-20" onChange={() => {}} />);
    expect(screen.getByLabelText("Contract date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Contract date")).toHaveValue("2026-05-20");
  });

  it("can ask for a number keyboard and draw a symbol before the text", () => {
    render(<TextField label="Sold price" inputMode="decimal" prefix="$" value="1,365,000" onChange={() => {}} />);
    expect(screen.getByLabelText("Sold price")).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByText("$")).toBeInTheDocument();
  });
});

describe("text size on a phone", () => {
  it("is 16 px below the sm breakpoint, so iOS does not zoom into a box, and 15 px from it", () => {
    render(
      <>
        <MoneyField label="Price" valueCents={0} onChange={() => {}} />
        <TextField label="City" value="" onChange={() => {}} />
        <MonthField label="Land closes" value="2027-06" onChange={() => {}} />
      </>,
    );
    for (const label of ["Price", "City", "Land closes"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveClass("text-base", "sm:text-[15px]");
      expect(input).not.toHaveClass("text-[15px]");
    }
  });
});

describe("MonthField and DateField", () => {
  it("shows the month's format in the box, for a browser that has no month picker", () => {
    render(<MonthField label="Land closes" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Land closes")).toHaveAttribute("placeholder", "YYYY-MM");
  });

  it("keeps a hint given to a month field", () => {
    render(<MonthField label="Land closes" hint="When the lot is bought" value="2027-06" onChange={() => {}} />);
    expect(screen.getByLabelText("Land closes")).toHaveAccessibleDescription("When the lot is bought");
    expect(screen.getByLabelText("Land closes")).toHaveAttribute("placeholder", "YYYY-MM");
  });

  it("are native month and date inputs showing their value", () => {
    render(
      <>
        <MonthField label="Land closes" value="2027-06" onChange={() => {}} />
        <DateField label="Received" value="2026-10-31" onChange={() => {}} />
      </>,
    );
    expect(screen.getByLabelText("Land closes")).toHaveAttribute("type", "month");
    expect(screen.getByLabelText("Land closes")).toHaveValue("2027-06");
    expect(screen.getByLabelText("Received")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Received")).toHaveValue("2026-10-31");
  });

  it("call onChange with a well-formed month or date", () => {
    const onMonth = vi.fn();
    const onDate = vi.fn();
    render(
      <>
        <MonthField label="Land closes" value="2027-06" onChange={onMonth} />
        <DateField label="Received" value="2026-10-31" onChange={onDate} />
      </>,
    );
    fireEvent.change(screen.getByLabelText("Land closes"), { target: { value: "2027-09" } });
    fireEvent.change(screen.getByLabelText("Received"), { target: { value: "2026-11-02" } });
    expect(onMonth).toHaveBeenCalledWith("2027-09");
    expect(onDate).toHaveBeenCalledWith("2026-11-02");
  });

  it("fire nothing when the native input is emptied", () => {
    const onMonth = vi.fn();
    const onDate = vi.fn();
    render(
      <>
        <MonthField label="Land closes" value="2027-06" onChange={onMonth} />
        <DateField label="Received" value="2026-10-31" onChange={onDate} />
      </>,
    );
    fireEvent.change(screen.getByLabelText("Land closes"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Received"), { target: { value: "" } });
    expect(onMonth).not.toHaveBeenCalled();
    expect(onDate).not.toHaveBeenCalled();
    // The box looks empty while the deal keeps its old value, so the field says so.
    expect(screen.getByText("Enter a month")).toBeInTheDocument();
    expect(screen.getByText("Enter a date")).toBeInTheDocument();
    expect(screen.getByLabelText("Land closes")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Received")).toHaveAttribute("aria-invalid", "true");
  });

  it("clear the message once a well-formed value comes back", () => {
    const onMonth = vi.fn();
    render(<MonthField label="Land closes" value="2027-06" onChange={onMonth} />);
    fireEvent.change(screen.getByLabelText("Land closes"), { target: { value: "" } });
    expect(screen.getByText("Enter a month")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Land closes"), { target: { value: "2027-09" } });
    expect(screen.queryByText("Enter a month")).not.toBeInTheDocument();
    expect(onMonth).toHaveBeenCalledExactlyOnceWith("2027-09");
  });

  it("follow a new value from outside", () => {
    const { rerender } = render(<DateField label="Received" value="2026-10-31" onChange={() => {}} />);
    rerender(<DateField label="Received" value="2026-11-05" onChange={() => {}} />);
    expect(screen.getByLabelText("Received")).toHaveValue("2026-11-05");
  });

  it("show an outside error", () => {
    render(<DateField label="Received" value="2026-10-31" onChange={() => {}} error="Not a real date" />);
    expect(screen.getByText("Not a real date")).toBeInTheDocument();
    expect(screen.getByLabelText("Received")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("Toggle", () => {
  it("is a labelled checkbox that reports the new state", async () => {
    const onChange = vi.fn();
    render(<Toggle label="Basement ADU" checked={false} onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Basement ADU" });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows a checked box and reports unchecking", async () => {
    const onChange = vi.fn();
    render(<Toggle label="Basement ADU" checked onChange={onChange} />);
    const box = screen.getByLabelText("Basement ADU");
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("a field inside a parent that holds the state", () => {
  /** The pattern every screen uses: the parent owns the value, the field reports into it. */
  function MoneyParent({ initial, onChange }: { initial: Cents; onChange: (cents: Cents) => void }) {
    const [cents, setCents] = useState(initial);
    return (
      <>
        <MoneyField
          label="Lot price"
          valueCents={cents}
          onChange={(next) => {
            onChange(next);
            setCents(next);
          }}
        />
        <output data-testid="state">{cents}</output>
        <button type="button" onClick={() => setCents(initial)}>
          Undo
        </button>
      </>
    );
  }

  function PercentParent({ initial, onChange }: { initial: number; onChange: (decimal: number) => void }) {
    const [decimal, setDecimal] = useState(initial);
    return (
      <>
        <PercentField
          label="Contingency"
          value={decimal}
          onChange={(next) => {
            onChange(next);
            setDecimal(next);
          }}
        />
        <output data-testid="state">{decimal}</output>
        <button type="button" onClick={() => setDecimal(initial)}>
          Undo
        </button>
      </>
    );
  }

  it("MoneyField: the text and the parent agree after typing and tabbing away, and an undo shows through", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MoneyParent initial={29_500_000} onChange={onChange} />);
    const input = screen.getByLabelText("Lot price");
    expect(input).toHaveValue("295,000");

    await user.clear(input);
    await user.type(input, "1350000");
    expect(input).toHaveValue("1350000");
    expect(screen.getByTestId("state")).toHaveTextContent("135000000");

    await user.tab();
    expect(input).toHaveValue("1,350,000");
    expect(screen.getByTestId("state")).toHaveTextContent("135000000");
    expect(screen.queryByText("Enter a dollar amount")).not.toBeInTheDocument();

    // One report per keystroke that made a valid amount, and nothing echoed back by the blur or the re-render.
    expect(onChange).toHaveBeenCalledTimes(7);

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("state")).toHaveTextContent("29500000");
    expect(input).toHaveValue("295,000");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(onChange).toHaveBeenCalledTimes(7);
  });

  it("PercentField: the text and the parent agree after typing and tabbing away, and an undo shows through", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PercentParent initial={0.05} onChange={onChange} />);
    const input = screen.getByLabelText("Contingency");
    expect(input).toHaveValue("5.00");

    await user.clear(input);
    await user.type(input, "9.5");
    expect(screen.getByTestId("state")).toHaveTextContent("0.095");
    await user.tab();
    expect(input).toHaveValue("9.50");
    expect(screen.getByTestId("state")).toHaveTextContent("0.095");

    // More digits than the box tidies to: the text stays as typed, so what is shown is what the parent holds.
    await user.clear(input);
    await user.type(input, "7.125");
    await user.tab();
    expect(input).toHaveValue("7.125");
    expect(screen.getByTestId("state")).toHaveTextContent("0.07125");

    const calls = onChange.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("state")).toHaveTextContent("0.05");
    expect(input).toHaveValue("5.00");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(onChange).toHaveBeenCalledTimes(calls);
  });
});
