import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { DEFAULT_RULES } from "@engine";
import type { AuthGateway } from "../../data/auth/authGateway";
import { ALREADY_HAS_COMPANY } from "../../data/auth/companyGateway";
import type { Company, CompanyGateway } from "../../data/auth/companyGateway";
import { DataError } from "../../data/types";
import { TextField } from "../../ui/fields";
import { PRIMARY_BUTTON } from "../deal/stepShared";
import { AuthFrame, Problem } from "./AuthFrame";

export interface CreateCompanyPageProps {
  companies: CompanyGateway;
  /** Only for the signed-out case: its "Sign in" button signs out so the gate shows the sign-in page. */
  auth: AuthGateway;
  onCreated: (company: Company) => void;
}

const BAD_NAME = "Enter a company name of 120 characters or fewer.";

/** First sign-in: the owner names the company, which starts with the standard rules and a 5% contingency. */
export function CreateCompanyPage({
  companies,
  auth,
  onCreated,
}: CreateCompanyPageProps) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    form.current?.querySelector("input")?.focus();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.length > 120) {
      setNameError(BAD_NAME);
      return;
    }
    setNameError(undefined);
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      onCreated(
        await companies.createCompany(trimmed, {
          rules: DEFAULT_RULES,
          contingencyPct: 0.05,
        }),
      );
      return; // Stays busy: the caller replaces this page.
    } catch (error) {
      await explain(error);
    }
    inFlight.current = false;
    setBusy(false);
  }

  /** Shows what went wrong. A company that already exists (a create whose answer was lost) is simply carried on with. */
  async function explain(error: unknown) {
    if (error instanceof DataError && error.kind === "signedOut") {
      setSignedOut(true);
      return;
    }
    if (error instanceof DataError && error.message === ALREADY_HAS_COMPANY) {
      try {
        const existing = await companies.myCompany();
        if (existing) {
          onCreated(existing);
          return;
        }
      } catch {
        // Fall through to the original message.
      }
    }
    setProblem(
      error instanceof DataError
        ? error.message
        : "Couldn't create your company — try again in a minute.",
    );
  }

  if (signedOut) {
    return (
      <AuthFrame title="Name your company">
        <div className="flex flex-col gap-4">
          <p role="alert" className="m-0 text-[15px] text-no-go">
            You've been signed out. Sign in again.
          </p>
          <button
            type="button"
            onClick={() => void auth.signOut()}
            className={PRIMARY_BUTTON}
          >
            Sign in
          </button>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Name your company">
      <form
        ref={form}
        onSubmit={(e) => void create(e)}
        noValidate
        className="flex flex-col gap-4"
      >
        <TextField
          label="Company name"
          value={name}
          onChange={setName}
          error={nameError}
        />
        <button
          type="submit"
          disabled={busy}
          className={`${PRIMARY_BUTTON} disabled:cursor-default disabled:opacity-60`}
        >
          Create company
        </button>
        <Problem message={problem} />
      </form>
    </AuthFrame>
  );
}
