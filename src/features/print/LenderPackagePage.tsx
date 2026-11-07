import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { MissingItem } from "@engine";
import { FOCUS_RING, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../deal/stepShared";
import { DealCrashBoundary } from "../deal/DealCrashBoundary";
import { needText } from "../deal/needText";
import { stepForMissing, topNeeds } from "../deal/summary";
import { useDealEditor } from "../deal/useDealEditor";
import { AssumptionsSection, ScenariosSection, SummarySection, TimelineSection, VerdictSection } from "./DealSections";
import { CashFlowSection, DivisionsSection, MarketSection } from "./MoneySections";
import "./print.css";

const LINK = `font-semibold text-spruce underline-offset-2 hover:underline ${FOCUS_RING}`;
const BUTTON = "print:hidden";

/** "November 7, 2026": today on this device, as a lender reads a date. */
const PREPARED_ON = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper print:bg-white">
      <main className="mx-auto flex max-w-4xl flex-col gap-6 bg-surface px-4 py-6 text-ink sm:px-8 sm:py-8 print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}

function BackLink({ dealId }: { dealId: string }) {
  return (
    <Link
      to={`/deals/${dealId}/proforma`}
      className={`${BUTTON} inline-flex min-h-11 items-center self-start text-sm no-underline ${LINK}`}
    >
      ← Back to the pro forma
    </Link>
  );
}

function BackToDeals() {
  return (
    <Link to="/deals" className={`${SECONDARY_BUTTON} no-underline`}>
      Back to Deals
    </Link>
  );
}

/** The deal could not be read right now. Nothing is wrong with it, so nothing is offered that would change it. */
function Unavailable({ message }: { message: string }) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  async function retry() {
    setRetrying(true);
    try {
      await queryClient.refetchQueries({
        type: "active",
        predicate: (query) => query.state.status === "error",
      });
    } finally {
      setRetrying(false);
    }
  }
  return (
    <Page>
      <section className="flex flex-col items-start gap-3">
        <h1 className="m-0 text-xl font-bold tracking-[-0.01em]">Can't open this deal right now</h1>
        <p className="m-0 text-[15px]">{message}</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            className={`${PRIMARY_BUTTON} disabled:opacity-60`}
          >
            Try again
          </button>
          <BackToDeals />
        </div>
      </section>
    </Page>
  );
}

/** What stops the package, each item linked to the step that fixes it, as the deal's header lists them. */
function Needs({ dealId, missing }: { dealId: string; missing: readonly MissingItem[] }) {
  const { shown } = topNeeds(missing, Number.POSITIVE_INFINITY);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">Needs:</span>
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((item) => (
          <li key={item.message}>
            <Link
              to={`/deals/${dealId}/${stepForMissing(item)}`}
              className={`inline-flex min-h-11 items-center ${LINK}`}
            >
              {needText(item)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Package({ dealId }: { dealId: string }) {
  const editor = useDealEditor(dealId);
  const { status, deal, inputs, evaluatedInputs, evaluation } = editor;

  if (status === "notFound") {
    return (
      <Page>
        <section className="flex flex-col items-start gap-3">
          <h1 className="m-0 text-[30px] font-bold tracking-[-0.02em]">Deal not found</h1>
          <p className="m-0 text-muted">There is no deal at this address. It may have been deleted.</p>
          <BackToDeals />
        </section>
      </Page>
    );
  }
  if (status === "error") return <Unavailable message={editor.error?.message ?? "Unknown error"} />;
  if (status !== "ready" || !deal || !inputs || !evaluatedInputs || !evaluation) {
    return (
      <Page>
        <p role="status" aria-busy="true" className="m-0 text-muted">
          Loading…
        </p>
      </Page>
    );
  }

  const { scenarios, estimate, verdict } = evaluation;
  // The same test as the deal header's "Needs info": the verdict cannot be given. Without scenarios or an estimate there is
  // nothing to print either, whatever the verdict says.
  const ready = verdict.kind !== "incomplete" && scenarios.status === "ok" && estimate.status === "ok";
  if (!ready) {
    return (
      <Page>
        <BackLink dealId={dealId} />
        <h1 className="m-0 text-[30px] font-bold tracking-[-0.02em]">{deal.name}</h1>
        <p className="m-0 text-[15px]">This deal needs a few more details before it can be printed.</p>
        <Needs dealId={dealId} missing={verdict.missing ?? []} />
      </Page>
    );
  }

  const { base } = scenarios.value;
  return (
    <>
      <Page>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BackLink dealId={dealId} />
          <button type="button" onClick={() => window.print()} className={`${PRIMARY_BUTTON} ${BUTTON}`}>
            Print or save as PDF
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <p className="m-0 text-sm font-semibold uppercase tracking-[0.04em] text-muted">Lender package</p>
          <h1 className="m-0 text-[30px] font-bold tracking-[-0.02em]">{deal.name}</h1>
        </div>
        <SummarySection inputs={evaluatedInputs} />
        <VerdictSection verdict={verdict} />
        <ScenariosSection scenarios={scenarios.value} />
        <DivisionsSection estimate={estimate.value} />
        <MarketSection price={evaluation.price} scoredComps={evaluation.scoredComps} />
        <TimelineSection base={base} landClose={evaluatedInputs.timeline.landClose} />
        <CashFlowSection base={base} landClose={evaluatedInputs.timeline.landClose} />
        <AssumptionsSection inputs={evaluatedInputs} />
      </Page>
      <footer className="mx-auto max-w-4xl px-4 pb-8 text-xs text-muted sm:px-8 print:max-w-none print:p-0 print:pt-4">
        <p className="m-0">Decision support only — not an appraisal, legal advice, or a lending decision.</p>
        <p className="m-0">{`Prepared ${PREPARED_ON.format(new Date())} with Spec Studio.`}</p>
      </footer>
    </>
  );
}

/**
 * `#/deals/:dealId/print`: the deal as a document for a lender, drawn from the same evaluation as the deal screens and
 * laid out for paper. It only reads the deal: nothing on it edits, so nothing is ever saved from here.
 */
export function LenderPackagePage() {
  const { dealId = "" } = useParams();
  return (
    <DealCrashBoundary key={dealId}>
      <Package key={dealId} dealId={dealId} />
    </DealCrashBoundary>
  );
}
