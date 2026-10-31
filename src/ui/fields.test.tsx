import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DateField,
  MoneyField,
  MonthField,
  NumberField,
  OptionalMoneyField,
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
});

describe("MonthField and DateField", () => {
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
