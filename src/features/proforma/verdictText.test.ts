import { describe, expect, it } from "vitest";
import type { RuleCheck, Verdict } from "@engine";
import { checkLine, loanWarningText, verdictHeadline } from "./verdictText";

describe("verdictHeadline", () => {
  it("says what each verdict means", () => {
    expect(verdictHeadline("go")).toBe("Passes all your rules.");
    expect(verdictHeadline("marginal")).toBe("Makes money, but misses one of your rules.");
    expect(verdictHeadline("nogo")).toBe("Doesn't pass your rules.");
    expect(verdictHeadline("incomplete")).toBe("Needs a few more details.");
  });
});

const margin = (actual: number | null, pass: boolean, threshold = 0.15): RuleCheck => ({
  rule: "marginOnSale",
  pass,
  actual,
  threshold,
});
const annualized = (actual: number | null, pass: boolean, threshold = 0.25): RuleCheck => ({
  rule: "annualizedReturn",
  pass,
  actual,
  threshold,
});
const downside = (actual: number | null, pass: boolean, threshold = 0): RuleCheck => ({
  rule: "downsideProfit",
  pass,
  actual,
  threshold,
});

describe("checkLine", () => {
  describe("margin on sale", () => {
    it("states the rule when it fails", () => {
      expect(checkLine(margin(0.125, false))).toBe("Margin 12.5% — your rule is 15.0% or better");
    });
    it("says it beats the rule when it passes", () => {
      expect(checkLine(margin(0.172, true))).toBe("Margin 17.2% — beats your 15.0% rule");
    });
    it("says it meets the rule when it is exactly on it", () => {
      expect(checkLine(margin(0.15, true))).toBe("Margin 15.0% — meets your 15.0% rule");
    });
    it("writes a loss with the minus sign", () => {
      expect(checkLine(margin(-0.037, false))).toBe("Margin −3.7% — your rule is 15.0% or better");
    });
    it("says it cannot be computed without a value", () => {
      expect(checkLine(margin(null, false))).toBe("Margin — can't be computed");
    });
  });

  describe("annualized return", () => {
    it("says it beats the rule when it passes", () => {
      expect(checkLine(annualized(0.319, true))).toBe("Annualized return 31.9% — beats your 25.0% rule");
    });
    it("states the rule when it fails", () => {
      expect(checkLine(annualized(0.2012, false))).toBe("Annualized return 20.1% — your rule is 25.0% or better");
    });
    it("says it meets the rule when it is exactly on it", () => {
      expect(checkLine(annualized(0.25, true))).toBe("Annualized return 25.0% — meets your 25.0% rule");
    });
    it("says it cannot be computed when there is no return", () => {
      expect(checkLine(annualized(null, false))).toBe("Annualized return — can't be computed");
    });
  });

  describe("downside profit", () => {
    it("says it passes the rule", () => {
      expect(checkLine(downside(12_462_300, true))).toBe("Downside profit $124,623 — passes your $0 rule");
    });
    it("states the rule when it fails, with a loss in the engine's minus sign", () => {
      expect(checkLine(downside(-318_757, false))).toBe("Downside profit −$3,188 — your rule is $0 or better");
    });
    it("works against a rule above zero", () => {
      expect(checkLine(downside(2_500_000, false, 5_000_000))).toBe(
        "Downside profit $25,000 — your rule is $50,000 or better",
      );
      expect(checkLine(downside(6_000_000, true, 5_000_000))).toBe("Downside profit $60,000 — passes your $50,000 rule");
    });
    it("says it cannot be computed without a value", () => {
      expect(checkLine(downside(null, false))).toBe("Downside profit — can't be computed");
    });
  });
});

describe("loanWarningText", () => {
  const warning = (maxDomWithoutExtension: number | null, baseDomDays: number, extensions: number) =>
    ({ maxDomWithoutExtension, baseDomDays, extensions }) satisfies NonNullable<Verdict["loanWarning"]>;

  it("says how soon it must go under contract, what is typical, and the one extension fee in the numbers", () => {
    expect(loanWarningText(warning(56, 62, 1))).toBe(
      "Loan heads-up: to avoid an extension it must go under contract within 56 days (typical here is 62). 1 extension fee is already in the numbers.",
    );
  });

  it("pluralizes the extension fees", () => {
    expect(loanWarningText(warning(56, 400, 4))).toBe(
      "Loan heads-up: to avoid an extension it must go under contract within 56 days (typical here is 400). 4 extension fees are already in the numbers.",
    );
  });

  it("says day, not days, for one day", () => {
    expect(loanWarningText(warning(1, 62, 2))).toContain("within 1 day (typical");
  });

  it("says the loan ends before the sale closes when there are no days to spare", () => {
    const text = "Loan heads-up: the loan term ends before the sale closes, so extension fees apply.";
    expect(loanWarningText(warning(0, 62, 3))).toBe(text);
    expect(loanWarningText(warning(null, 62, 3))).toBe(text);
  });
});
