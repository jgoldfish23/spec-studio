import { useState } from "react";
import { useNavigate } from "react-router";
import { DEFAULT_MARKET_SETTINGS } from "@engine";
import { newDealInputs } from "../../data/newDeal";
import {
  useCompanySettings,
  useComps,
  useCreateDeal,
  useDeals,
  useDeleteDeal,
  useRepository,
  useResetDeals,
  useSaveComp,
} from "../../data/queries";
import { SAMPLE_DEAL_NAME, sampleComps, sampleDealInputs } from "../../data/sample";
import type { StoredDeal } from "../../data/types";
import { errorMessage } from "../../lib/errorMessage";
import { formatMoney, formatPercentCompact } from "../../lib/format";
import { todayIso } from "../../lib/today";
import { Card } from "../../ui/Card";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DealsTable } from "./DealsTable";

/** The one region Plan 2 knows: Northern Utah (Davis & Weber). */
const REGION = DEFAULT_MARKET_SETTINGS.region;

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";
const BUTTON = `inline-flex min-h-11 items-center gap-2 rounded-lg px-4.5 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

/** The unreadable-store problem: the repository reports a store it cannot read as a problem with this id. */
const WHOLE_STORE = "*";

/** What the owner is being asked to confirm. */
type Confirming = { kind: "delete"; id: string; name: string } | { kind: "reset" } | null;

function RulesCard() {
  const rules = useCompanySettings().data?.rules;
  return (
    <Card
      title="Go/no-go rules"
      actions={
        <span className="flex items-center gap-2">
          <button
            type="button"
            disabled
            className="inline-flex min-h-11 items-center rounded-lg border border-[#C9CEC8] px-3.5 text-sm font-semibold text-muted opacity-70"
          >
            Edit
          </button>
          <span className="rounded-sm border border-line px-1.5 py-px text-[11px] text-muted">Later</span>
        </span>
      }
    >
      {rules ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-[#33403A]">
          <li className="flex justify-between gap-2">
            <span>Margin on sale price</span>
            <strong>{`≥ ${formatPercentCompact(rules.minMarginOnSale, 1)}`}</strong>
          </li>
          <li className="flex justify-between gap-2">
            <span>Annualized return on cash</span>
            <strong>{`≥ ${formatPercentCompact(rules.minAnnualizedReturn, 1)}`}</strong>
          </li>
          <li className="flex justify-between gap-2">
            <span>Downside case profit</span>
            <strong>{`≥ ${formatMoney(rules.minDownsideProfitCents)}`}</strong>
          </li>
        </ul>
      ) : (
        <p className="m-0 text-sm text-muted">Loading…</p>
      )}
    </Card>
  );
}

function CompsCard() {
  const comps = useComps(REGION).data;
  const sold = comps?.filter((comp) => comp.status === "sold").length;
  return (
    <Card title="Comps library">
      <p className="m-0 text-sm leading-normal text-[#33403A]">
        {sold === undefined ? "Loading…" : `${sold} sold ${sold === 1 ? "comp" : "comps"} in Northern Utah.`}
      </p>
    </Card>
  );
}

export function DealsPage() {
  const navigate = useNavigate();
  const repository = useRepository();
  const deals = useDeals();
  const createDeal = useCreateDeal();
  const deleteDeal = useDeleteDeal();
  const saveComp = useSaveComp();
  const resetDeals = useResetDeals();

  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** Runs one action. One at a time, so a double click cannot start a deal twice; a failure is shown, not thrown. */
  async function perform(failureText: string, action: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(`${failureText}: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const startDeal = () =>
    perform("Couldn't create the deal", async () => {
      const settings = await repository.getCompanySettings();
      const deal = await createDeal.mutateAsync({ name: "Untitled deal", inputs: newDealInputs(todayIso(), settings) });
      void navigate(`/deals/${deal.id}/lot`);
    });

  const loadSample = () =>
    perform("Couldn't load the sample deal", async () => {
      // The comps first, so the sample is priced the moment it opens. A comp is replaced by id, so this is repeatable.
      for (const comp of sampleComps()) await saveComp.mutateAsync(comp);
      const deal = await createDeal.mutateAsync({ name: SAMPLE_DEAL_NAME, inputs: sampleDealInputs() });
      void navigate(`/deals/${deal.id}/proforma`);
    });

  const removeDeal = (id: string) => perform("Couldn't delete the deal", () => deleteDeal.mutateAsync(id));
  const removeEverything = () => perform("Couldn't remove the saved deals", () => resetDeals.mutateAsync());

  const confirm = (): void => {
    const pending = confirming;
    setConfirming(null);
    if (pending?.kind === "delete") void removeDeal(pending.id);
    else if (pending?.kind === "reset") void removeEverything();
  };

  const list = deals.data;
  const hasSample = list?.deals.some((deal) => deal.name === SAMPLE_DEAL_NAME) ?? false;
  const askToDelete = (deal: StoredDeal) => setConfirming({ kind: "delete", id: deal.id, name: deal.name });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[30px] font-bold tracking-[-0.02em]">Deals</h1>
          <p className="m-0 text-[15px] text-muted">Every lot you're sizing up, with its go/no-go verdict.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {list && !hasSample ? (
            <button
              type="button"
              onClick={() => void loadSample()}
              disabled={busy}
              className={`${BUTTON} border border-spruce bg-surface text-spruce hover:bg-paper`}
            >
              Load sample deal
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void startDeal()}
            disabled={busy}
            className={`${BUTTON} bg-spruce text-white hover:bg-spruce-dark`}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            New deal
          </button>
        </div>
      </div>

      {failure ? (
        <p role="alert" className="m-0 rounded-lg border border-[#F2C2BE] bg-no-go-bg px-4 py-3 text-sm font-medium text-no-go">
          {failure}
        </p>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        <RulesCard />
        <Card title="Cost book">
          <p className="m-0 text-sm leading-normal text-[#33403A]">
            Northern Utah starter estimates (unverified), as of Oct 2026. Replace them with your bids.
          </p>
        </Card>
        <CompsCard />
      </div>

      {list && list.problems.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {list.problems.map((problem) => {
            const whole = problem.id === WHOLE_STORE;
            return (
              <li
                key={problem.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#F2C2BE] bg-no-go-bg px-4 py-2 text-sm text-no-go"
              >
                <span className="min-w-0 flex-1">
                  {whole ? "Your saved deals couldn't be read" : `Couldn't read one saved deal (${problem.id}): ${problem.message}`}
                  {whole ? <span className="block font-normal text-[13px]">{problem.message}</span> : null}
                </span>
                <button
                  type="button"
                  aria-label={whole ? undefined : `Remove ${problem.id}`}
                  disabled={busy}
                  onClick={() => (whole ? setConfirming({ kind: "reset" }) : void removeDeal(problem.id))}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-no-go px-3.5 text-sm font-semibold text-no-go hover:bg-surface disabled:opacity-60 ${focusRing}`}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* With nothing readable the problem rows above are the whole story: no empty list under a heading. */}
      {list && list.deals.length === 0 && list.problems.length > 0 ? null : (
        <section aria-labelledby="deals-heading" className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-5 py-4">
            <h2 id="deals-heading" className="m-0 text-[17px] font-bold">
              All deals
            </h2>
          </div>
          {deals.isError ? (
            <p role="alert" className="m-0 px-5 py-6 text-sm font-medium text-no-go">
              {`Couldn't load your deals: ${errorMessage(deals.error)}`}
            </p>
          ) : list === undefined ? (
            <p role="status" className="m-0 px-5 py-6 text-sm text-muted">
              Loading deals…
            </p>
          ) : list.deals.length > 0 ? (
            <DealsTable deals={list.deals} today={todayIso()} onDelete={askToDelete} />
          ) : (
            <p className="m-0 px-5 py-8 text-center text-[15px] text-muted">
              No deals yet — start one, or load the sample deal to look around.
            </p>
          )}
        </section>
      )}

      {confirming ? (
        <ConfirmDialog
          message={confirming.kind === "delete" ? `Delete ${confirming.name}? This can't be undone.` : "Remove all saved deals? This can't be undone."}
          confirmLabel={confirming.kind === "delete" ? "Delete" : "Remove all"}
          onConfirm={confirm}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}
