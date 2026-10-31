import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Card } from "./Card";
import { SegmentedControl } from "./SegmentedControl";
import { SourceBadge } from "./SourceBadge";
import { StatTile } from "./StatTile";
import { VerdictChip } from "./VerdictChip";

type Slope = "flat" | "gentle" | "steep";
const SLOPES = [
  { value: "flat", label: "Flat" },
  { value: "gentle", label: "Gentle" },
  { value: "steep", label: "Steep" },
] as const satisfies { value: Slope; label: string }[];

describe("SegmentedControl", () => {
  it("is a named group of buttons, with the selected one pressed", () => {
    render(<SegmentedControl<Slope> label="Slope" options={[...SLOPES]} value="gentle" onChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Slope" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Flat", "Gentle", "Steep"]);
    expect(screen.getByRole("button", { name: "Gentle" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Flat" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Steep" })).toHaveAttribute("aria-pressed", "false");
    for (const b of buttons) expect(b).toHaveAttribute("type", "button");
  });

  it("calls onChange with the value of the option clicked", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl<Slope> label="Slope" options={[...SLOPES]} value="gentle" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Steep" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("steep");
  });

  it("does not call onChange for the option that is already selected", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl<Slope> label="Slope" options={[...SLOPES]} value="gentle" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Gentle" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a disabled option disabled, and a click on it does nothing", async () => {
    const onChange = vi.fn();
    const options = [SLOPES[0], SLOPES[1], { ...SLOPES[2], disabled: true }];
    render(<SegmentedControl<Slope> label="Slope" options={options} value="gentle" onChange={onChange} />);
    const steep = screen.getByRole("button", { name: "Steep" });
    expect(steep).toBeDisabled();
    await userEvent.click(steep);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("VerdictChip", () => {
  it.each([
    ["go", "Go"],
    ["marginal", "Marginal"],
    ["nogo", "No-go"],
    ["incomplete", "Needs info"],
  ] as const)("shows %s as exactly %j, with an icon that is hidden from readers", (kind, text) => {
    const { container } = render(<VerdictChip kind={kind} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.textContent).toBe(text);
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("has the text No-go for nogo", () => {
    render(<VerdictChip kind="nogo" />);
    expect(screen.getByText("No-go")).toBeInTheDocument();
  });

  it("takes a large size and keeps the same text", () => {
    const { container } = render(<VerdictChip kind="go" size="lg" />);
    expect(container.textContent).toBe("Go");
  });
});

describe("SourceBadge", () => {
  it.each([
    ["bid", "Bid"],
    ["priceBook", "Price book"],
    ["default", "Default"],
  ] as const)("shows %s as %j and no old-price chip", (source, text) => {
    const { container } = render(<SourceBadge source={source} />);
    expect(container.textContent).toBe(text);
    expect(screen.queryByText("Old price")).not.toBeInTheDocument();
  });

  it("adds an Old price chip when stale", () => {
    render(<SourceBadge source="priceBook" stale />);
    expect(screen.getByText("Price book")).toBeInTheDocument();
    expect(screen.getByText("Old price")).toBeInTheDocument();
  });
});

describe("Card", () => {
  it("is a region named by its heading", () => {
    render(
      <Card title="Price & closing">
        <p>Body</p>
      </Card>,
    );
    const region = screen.getByRole("region", { name: "Price & closing" });
    expect(within(region).getByRole("heading", { level: 2, name: "Price & closing" })).toBeInTheDocument();
    expect(within(region).getByText("Body")).toBeInTheDocument();
  });

  it("shows the actions slot beside the title", () => {
    render(
      <Card title="Comps" actions={<button type="button">Add comp</button>}>
        <p>Body</p>
      </Card>,
    );
    const region = screen.getByRole("region", { name: "Comps" });
    expect(within(region).getByRole("button", { name: "Add comp" })).toBeInTheDocument();
  });

  it("gives two cards two different names", () => {
    render(
      <>
        <Card title="One">a</Card>
        <Card title="Two">b</Card>
      </>,
    );
    expect(screen.getByRole("region", { name: "One" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Two" })).toBeInTheDocument();
  });
});

describe("StatTile", () => {
  it("pairs its label with its value", () => {
    render(<StatTile label="Profit" value="$161,500" />);
    expect(screen.getByRole("term")).toHaveTextContent("Profit");
    expect(screen.getByRole("definition")).toHaveTextContent("$161,500");
  });

  it("takes any node as the value", () => {
    render(<StatTile label="Verdict" value={<VerdictChip kind="go" />} />);
    expect(within(screen.getByRole("definition")).getByText("Go")).toBeInTheDocument();
  });
});
