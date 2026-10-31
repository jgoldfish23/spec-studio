import { describe, expect, it } from "vitest";
import { CompSchema } from "@engine";
import type { Comp } from "@engine";
import { sampleComps } from "../../data/sample";
import { compFromForm, emptyCompForm, formFromComp, keepUnshownFields } from "./compForm";
import type { CompFormValues } from "./compForm";

const ID = "7d5f2b1e-3c1a-4b8e-9a52-6f1d1c0a9e11";

/** A form that is complete and valid: a 2026 sale of a house built in 2025. */
function validForm(change: Partial<CompFormValues> = {}): CompFormValues {
  return {
    ...emptyCompForm("Davis"),
    address: "12 Oak Lane, Kaysville, UT",
    city: "Kaysville",
    listDate: "2026-04-15",
    soldDate: "2026-06-15",
    soldPrice: "1,365,000",
    aboveGradeSf: "2,173",
    basementSf: "1,777",
    unfinishedSf: "0",
    beds: "5",
    baths: "4",
    yearBuilt: "2025",
    lotAcres: "0.3",
    garageBays: "3",
    basementFinish: "partial",
    ...change,
  };
}

/** The issues for a form, as `path: message` pairs. */
function issuesOf(values: CompFormValues): Record<string, string> {
  return Object.fromEntries(compFromForm(values, "utah-north", ID).issues.map((issue) => [issue.path, issue.message]));
}

describe("emptyCompForm", () => {
  it("fills in the county and leaves everything else empty", () => {
    expect(emptyCompForm("Weber")).toEqual({
      address: "",
      city: "",
      county: "Weber",
      listDate: "",
      contractDate: "",
      soldDate: "",
      soldPrice: "",
      listPrice: "",
      aboveGradeSf: "",
      basementSf: "",
      unfinishedSf: "",
      beds: "",
      baths: "",
      yearBuilt: "",
      lotAcres: "",
      garageBays: "",
      basementFinish: "none",
      walkout: false,
      adu: false,
      pool: false,
    });
  });
});

describe("compFromForm: a complete form", () => {
  it("makes a comp that passes CompSchema, with the id and region it was given", () => {
    const { comp, issues } = compFromForm(validForm(), "utah-north", ID);
    expect(issues).toEqual([]);
    expect(comp).toBeDefined();
    expect(CompSchema.safeParse(comp).success).toBe(true);
    expect(comp).toEqual({
      id: ID,
      address: "12 Oak Lane, Kaysville, UT",
      city: "Kaysville",
      county: "Davis",
      region: "utah-north",
      status: "sold",
      listDate: "2026-04-15",
      listPriceCents: 136_500_000,
      soldDate: "2026-06-15",
      soldPriceCents: 136_500_000,
      aboveGradeFinishedSf: 2173,
      basementFinishedSf: 1777,
      unfinishedSf: 0,
      beds: 5,
      baths: 4,
      yearBuilt: 2025,
      newConstruction: true,
      lotAcres: 0.3,
      garageBays: 3,
      basementFinish: "partial",
      walkout: false,
      adu: false,
      pool: false,
      source: "manual",
      verified: true,
    });
  });

  it("uses the sold price as the list price when the list price is blank, and the typed one when it is not", () => {
    expect(compFromForm(validForm({ listPrice: "" }), "utah-north", ID).comp?.listPriceCents).toBe(136_500_000);
    expect(compFromForm(validForm({ listPrice: "1,400,000" }), "utah-north", ID).comp?.listPriceCents).toBe(140_000_000);
  });

  it("leaves a blank optional field out instead of storing null or undefined", () => {
    const { comp } = compFromForm(validForm({ contractDate: "" }), "utah-north", ID);
    expect(comp).toBeDefined();
    expect("contractDate" in (comp as Comp)).toBe(false);
    expect("notes" in (comp as Comp)).toBe(false);
    // Plain JSON: nothing in it is null or undefined.
    const values = Object.values(comp as Comp);
    expect(values.every((value) => value !== null && value !== undefined)).toBe(true);
    expect(JSON.parse(JSON.stringify(comp))).toEqual(comp);
  });

  it("keeps a contract date that was typed", () => {
    expect(compFromForm(validForm({ contractDate: "2026-05-20" }), "utah-north", ID).comp?.contractDate).toBe("2026-05-20");
  });

  it("counts blank size, bed, bath, lot and garage boxes as zero", () => {
    const { comp, issues } = compFromForm(
      validForm({ basementSf: "", unfinishedSf: "", beds: "", baths: "", lotAcres: "", garageBays: "" }),
      "utah-north",
      ID,
    );
    expect(issues).toEqual([]);
    expect(comp).toMatchObject({
      basementFinishedSf: 0,
      unfinishedSf: 0,
      beds: 0,
      baths: 0,
      lotAcres: 0,
      garageBays: 0,
    });
  });

  it("reads grouped numbers, dollar signs and cents the way the other fields do", () => {
    const { comp, issues } = compFromForm(
      validForm({ soldPrice: "$1,365,000.50", aboveGradeSf: "2,173.5", baths: "2.5" }),
      "utah-north",
      ID,
    );
    expect(issues).toEqual([]);
    expect(comp).toMatchObject({ soldPriceCents: 136_500_050, aboveGradeFinishedSf: 2173.5, baths: 2.5 });
  });

  it("trims the text boxes", () => {
    const { comp } = compFromForm(validForm({ address: "  12 Oak Lane  ", city: " Kaysville ", county: " Davis " }), "utah-north", ID);
    expect(comp).toMatchObject({ address: "12 Oak Lane", city: "Kaysville", county: "Davis" });
  });

  it("carries the basement finish and the three feature boxes", () => {
    const { comp } = compFromForm(
      validForm({ basementFinish: "finished", walkout: true, adu: true, pool: true }),
      "utah-north",
      ID,
    );
    expect(comp).toMatchObject({ basementFinish: "finished", walkout: true, adu: true, pool: true });
  });
});

describe("compFromForm: new construction", () => {
  it.each([
    ["2026-06-15", "2026", true],
    ["2026-06-15", "2023", true], // sold three years after it was built
    ["2026-06-15", "2022", false], // four years
    ["2026-12-15", "2023", true], // late in the year still counts by year
  ])("sold %s and built %s is new construction: %s", (soldDate, yearBuilt, expected) => {
    const { comp } = compFromForm(validForm({ soldDate, yearBuilt }), "utah-north", ID);
    expect(comp?.newConstruction).toBe(expected);
  });
});

describe("compFromForm: what is required", () => {
  it("asks for the address, city, both dates, the above-grade area and the year built", () => {
    const issues = issuesOf({ ...emptyCompForm("Davis") });
    expect(issues).toMatchObject({
      address: "Required",
      city: "Required",
      listDate: "Required",
      soldDate: "Required",
      aboveGradeSf: "Required",
      yearBuilt: "Required",
      soldPrice: "Enter the sold price",
    });
    expect(Object.keys(issues).sort()).toEqual(
      ["address", "city", "listDate", "soldDate", "soldPrice", "aboveGradeSf", "yearBuilt"].sort(),
    );
  });

  it("treats a box with only spaces as empty", () => {
    expect(issuesOf(validForm({ address: "   " }))).toEqual({ address: "Required" });
  });

  it("does not make a comp while anything is missing", () => {
    const result = compFromForm(validForm({ soldPrice: "" }), "utah-north", ID);
    expect(result.comp).toBeUndefined();
    expect(result.issues).toEqual([{ path: "soldPrice", message: "Enter the sold price" }]);
  });

  it("names the field of the form, not the field of the comp, in each issue", () => {
    const paths = compFromForm({ ...emptyCompForm("Davis") }, "utah-north", ID).issues.map((issue) => issue.path);
    expect(paths).not.toContain("soldPriceCents");
    expect(paths).not.toContain("aboveGradeFinishedSf");
  });
});

describe("compFromForm: what CompSchema says", () => {
  it("puts a sold date before the list date at the sold date", () => {
    expect(issuesOf(validForm({ listDate: "2026-06-15", soldDate: "2026-04-15" }))).toEqual({
      soldDate: "Sold date is before the list date",
    });
  });

  it("accepts a sale on the list date", () => {
    expect(issuesOf(validForm({ listDate: "2026-06-15", soldDate: "2026-06-15" }))).toEqual({});
  });

  it("puts a contract date before the list date or after the sold date at the contract date", () => {
    expect(issuesOf(validForm({ contractDate: "2026-04-01" }))).toEqual({ contractDate: "Contract date is before the list date" });
    expect(issuesOf(validForm({ contractDate: "2026-07-01" }))).toEqual({ contractDate: "Contract date is after the sold date" });
    expect(issuesOf(validForm({ contractDate: "2026-05-20" }))).toEqual({});
  });

  it("maps a schema message to the field it came from", () => {
    expect(issuesOf(validForm({ yearBuilt: "1700" }))).toEqual({ yearBuilt: "Must be 1800 or more" });
    expect(issuesOf(validForm({ garageBays: "11" }))).toEqual({ garageBays: "Must be 10 or less" });
    expect(issuesOf(validForm({ soldPrice: "0" }))).toEqual({ soldPrice: "Must be above 0" });
    expect(issuesOf(validForm({ listPrice: "0" }))).toEqual({ listPrice: "Must be above 0" });
    expect(issuesOf(validForm({ aboveGradeSf: "-5" }))).toEqual({ aboveGradeSf: "Must be 0 or more" });
    expect(issuesOf(validForm({ listDate: "1850-04-15", soldDate: "1850-06-15" }))).toMatchObject({
      listDate: "Year must be 1900 or later",
    });
  });

  it("says what is wrong with text that is not a number", () => {
    expect(issuesOf(validForm({ soldPrice: "a lot" }))).toEqual({ soldPrice: "Enter a dollar amount" });
    expect(issuesOf(validForm({ listPrice: "cheap" }))).toEqual({ listPrice: "Enter a dollar amount" });
    expect(issuesOf(validForm({ aboveGradeSf: "big" }))).toEqual({ aboveGradeSf: "Enter a number" });
    expect(issuesOf(validForm({ yearBuilt: "2025.5" }))).toEqual({ yearBuilt: "Enter a whole number" });
    expect(issuesOf(validForm({ garageBays: "2.5" }))).toEqual({ garageBays: "Enter a whole number" });
    expect(issuesOf(validForm({ lotAcres: "x" }))).toEqual({ lotAcres: "Enter a number" });
  });

  it("gives one message per field", () => {
    const issues = compFromForm(validForm({ soldPrice: "0", yearBuilt: "1700", soldDate: "" }), "utah-north", ID).issues;
    const paths = issues.map((issue) => issue.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("lists issues in the order the form shows its fields", () => {
    const paths = compFromForm({ ...emptyCompForm("Davis") }, "utah-north", ID).issues.map((issue) => issue.path);
    expect(paths).toEqual(["address", "city", "listDate", "soldDate", "soldPrice", "aboveGradeSf", "yearBuilt"]);
  });
});

describe("formFromComp", () => {
  it("shows a comp's facts as the text of each box", () => {
    const [first] = sampleComps();
    expect(formFromComp(first as Comp)).toEqual({
      address: "Sample comp 1, Kaysville, UT",
      city: "Kaysville",
      county: "Davis",
      listDate: "2026-04-15",
      contractDate: "",
      soldDate: "2026-06-15",
      soldPrice: "1,365,000",
      listPrice: "1,365,000",
      aboveGradeSf: "2,173",
      basementSf: "1,777",
      unfinishedSf: "0",
      beds: "5",
      baths: "4",
      yearBuilt: "2025",
      lotAcres: "0.3",
      garageBays: "3",
      basementFinish: "partial",
      walkout: false,
      adu: false,
      pool: false,
    });
  });

  it("turns each sample comp back into itself", () => {
    for (const comp of sampleComps()) {
      const back = compFromForm(formFromComp(comp), comp.region, comp.id);
      expect(back.issues).toEqual([]);
      expect(back.comp).toEqual(comp);
    }
  });

  it("round-trips a contract date, a list price that differs from the sold price and cents", () => {
    const comp: Comp = {
      ...(sampleComps()[0] as Comp),
      contractDate: "2026-05-20",
      listPriceCents: 139_900_000,
      soldPriceCents: 136_500_050,
    };
    const back = compFromForm(formFromComp(comp), comp.region, comp.id);
    expect(back.issues).toEqual([]);
    expect(back.comp).toEqual(comp);
  });

  it("leaves the boxes of a facts-less comp empty instead of showing undefined", () => {
    const comp: Comp = {
      ...(sampleComps()[0] as Comp),
      status: "active",
    };
    delete comp.soldDate;
    delete comp.soldPriceCents;
    delete comp.listDate;
    delete comp.listPriceCents;
    const form = formFromComp(comp);
    expect(form).toMatchObject({ soldDate: "", soldPrice: "", listDate: "", listPrice: "" });
  });
});

describe("keepUnshownFields", () => {
  it("brings back the facts of the original that the form has no box for", () => {
    const original: Comp = {
      ...(sampleComps()[0] as Comp),
      originalListPriceCents: 140_000_000,
      priceCuts: 2,
      notes: "Corner lot",
    };
    const edited = compFromForm(formFromComp(original), original.region, original.id).comp as Comp;
    expect(edited.notes).toBeUndefined();
    expect(keepUnshownFields(edited, original)).toEqual(original);
  });

  it("adds nothing when the original had nothing extra", () => {
    const original = sampleComps()[0] as Comp;
    const edited = compFromForm(formFromComp(original), original.region, original.id).comp as Comp;
    const kept = keepUnshownFields(edited, original);
    expect(Object.keys(kept).sort()).toEqual(Object.keys(edited).sort());
  });
});
