import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RULES } from "@engine";
import type { Company } from "../../data/auth/companyGateway";
import {
  createFakeAuth,
  createFakeCompanies,
} from "../../data/testing/fakeAuth";
import { DataError } from "../../data/types";
import { CreateCompanyPage } from "./CreateCompanyPage";

function setup(companies = createFakeCompanies(), auth = createFakeAuth()) {
  const onCreated = vi.fn<(company: Company) => void>();
  render(
    <CreateCompanyPage
      companies={companies}
      auth={auth}
      onCreated={onCreated}
    />,
  );
  return { onCreated, companies, auth };
}

const create = () =>
  userEvent.click(screen.getByRole("button", { name: "Create company" }));

describe("CreateCompanyPage", () => {
  it("shows the heading and the focused field", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: "Name your company" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveFocus();
  });

  it("creates with the trimmed name and default settings, then calls onCreated", async () => {
    const companies = createFakeCompanies();
    const spy = vi.spyOn(companies, "createCompany");
    const { onCreated } = setup(companies);
    await userEvent.type(screen.getByLabelText("Company name"), "  Acme  ");
    await create();
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(spy).toHaveBeenCalledWith("Acme", {
      rules: DEFAULT_RULES,
      contingencyPct: 0.05,
    });
    expect(onCreated.mock.calls[0]?.[0].name).toBe("Acme");
  });

  it("creates only once on a double click", async () => {
    const companies = createFakeCompanies();
    const create = companies.createCompany.bind(companies);
    let release = () => {};
    const slow = new Promise<void>((resolve) => (release = resolve));
    const spy = vi
      .spyOn(companies, "createCompany")
      .mockImplementation(async (...args) => {
        await slow;
        return create(...args);
      });
    const { onCreated } = setup(companies);
    await userEvent.type(screen.getByLabelText("Company name"), "Acme");
    await userEvent.dblClick(
      screen.getByRole("button", { name: "Create company" }),
    );
    release();
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects a blank name and a name over 120 characters inline", async () => {
    const { companies } = setup();
    const spy = vi.spyOn(companies, "createCompany");
    await create();
    const message = "Enter a company name of 120 characters or fewer.";
    expect(screen.getByText(message)).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Company name"),
      "x".repeat(121),
    );
    await create();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows a gateway error's copy in a polite live region", async () => {
    const companies = createFakeCompanies();
    companies.createCompany = () =>
      Promise.reject(
        new DataError("Couldn't create your company — try again.", {
          kind: "failed",
        }),
      );
    setup(companies);
    await userEvent.type(screen.getByLabelText("Company name"), "Acme");
    await create();
    const message = await screen.findByText(
      "Couldn't create your company — try again.",
    );
    expect(message.closest("[aria-live='polite']")).not.toBeNull();
  });

  it("recovers from 'You already have a company' by loading it", async () => {
    const companies = createFakeCompanies();
    const existing: Company = {
      id: "c-1",
      name: "Acme",
      defaultRegion: "utah-north",
    };
    // The RPC worked but the re-read failed, so the retry says "already".
    await companies.createCompany("Acme", {
      rules: DEFAULT_RULES,
      contingencyPct: 0.05,
    });
    const { onCreated } = setup(companies);
    await userEvent.type(screen.getByLabelText("Company name"), "Acme");
    await create();
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onCreated.mock.calls[0]?.[0]).toEqual({
      ...existing,
      id: companies.companies.get("fake-user")?.id,
    });
  });

  it("shows the already-have-a-company error when there is no company to load", async () => {
    const companies = createFakeCompanies();
    companies.createCompany = () =>
      Promise.reject(
        new DataError("You already have a company.", { kind: "failed" }),
      );
    const { onCreated } = setup(companies);
    await userEvent.type(screen.getByLabelText("Company name"), "Acme");
    await create();
    expect(
      await screen.findByText("You already have a company."),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("on signedOut says so and offers Sign in, which signs out", async () => {
    const companies = createFakeCompanies();
    companies.createCompany = () =>
      Promise.reject(
        new DataError("You've been signed out.", { kind: "signedOut" }),
      );
    const auth = createFakeAuth();
    const signOut = vi.spyOn(auth, "signOut");
    setup(companies, auth);
    await userEvent.type(screen.getByLabelText("Company name"), "Acme");
    await create();
    expect(
      await screen.findByText("You've been signed out. Sign in again."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});
