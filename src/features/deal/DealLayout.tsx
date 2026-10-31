import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import type { DealEvaluation, DealInputs } from "@engine";
import { useDeleteDeal } from "../../data/queries";
import { errorMessage, withoutSavePrefix } from "../../lib/errorMessage";
import { formatDayRange, formatMoney, formatPercent } from "../../lib/format";
import { CalcErrorBoundary } from "../../ui/CalcErrorBoundary";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { TextField } from "../../ui/fields";
import { StatTile } from "../../ui/StatTile";
import { VerdictChip } from "../../ui/VerdictChip";
import type { SaveStatus } from "./autosaver";
import { useDealEditorContext } from "./DealEditorContext";
import type { DealEditor, EvaluationError } from "./useDealEditor";
import { STEPS } from "./steps";
import { needText } from "./needText";
import { headsUp, stepForMissing, summarize, topNeeds } from "./summary";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";
const LINK = `font-semibold text-spruce underline-offset-2 hover:underline ${focusRing}`;
const PRIMARY_BUTTON = `inline-flex min-h-11 items-center rounded-lg bg-spruce px-4.5 font-semibold text-white hover:bg-spruce-dark ${focusRing}`;
const SMALL_BUTTON = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[#C9CEC8] bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-paper disabled:cursor-not-allowed disabled:text-muted disabled:opacity-60 ${focusRing}`;

// ---------------------------------------------------------------------------------------------------------------
// States other than a deal that is ready

function DealSkeleton() {
  return (
    <div role="status" aria-label="Loading deal" className="flex animate-pulse flex-col gap-4">
      <div className="h-8 w-48 rounded-lg bg-line" />
      <div className="h-24 rounded-xl bg-line" />
      <div className="h-64 rounded-xl bg-line" />
    </div>
  );
}

function DealNotFound() {
  return (
    <section className="flex flex-col items-start gap-3">
      <h1 className="text-[30px] font-bold tracking-[-0.02em]">Deal not found</h1>
      <p className="m-0 text-muted">There is no deal at this address. It may have been deleted.</p>
      <Link to="/deals" className={PRIMARY_BUTTON}>
        Back to Deals
      </Link>
    </section>
  );
}

function DealUnreadable({ dealId, message }: { dealId: string; message: string }) {
  const editor = useDealEditorContext();
  const deleteDeal = useDeleteDeal();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function remove() {
    setConfirming(false);
    setFailure(null);
    try {
      // Nothing waiting may be saved after the deal is gone, or the save would bring it back.
      editor.discardChanges();
      await deleteDeal.mutateAsync(dealId);
      navigate("/deals");
    } catch (error) {
      setFailure(`Couldn't delete the deal: ${errorMessage(error)}`);
    }
  }

  return (
    <section className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-bold tracking-[-0.01em]">{`This deal couldn't be read: ${message}`}</h1>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`inline-flex min-h-11 items-center rounded-lg bg-no-go px-4.5 font-semibold text-white hover:bg-[#751C1C] ${focusRing}`}
        >
          Delete this deal
        </button>
        <Link to="/deals" className={`${SMALL_BUTTON} no-underline`}>
          Back to Deals
        </Link>
      </div>
      {failure ? (
        <p role="alert" className="m-0 font-medium text-no-go">
          {failure}
        </p>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          message="Delete this deal? This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The header of a ready deal

interface DealNameFieldProps {
  name: string;
  rename: (name: string) => boolean;
  saveNow: () => void;
}

function DealNameField({ name, rename, saveNow }: DealNameFieldProps) {
  const [text, setText] = useState(name);
  const [seenName, setSeenName] = useState(name);
  // The name changed from outside this box (a rename that was trimmed, a deal that was reloaded).
  if (seenName !== name) {
    setSeenName(name);
    setText(name);
  }

  // A name still being typed when the page is closed is kept, as a blur would keep it. The editor takes it at once
  // (`flushSync`, so its save is waiting before the handler goes on), and it is saved before the page goes.
  const typed = useRef({ text, name });
  useEffect(() => {
    typed.current = { text, name };
  }, [text, name]);
  useEffect(() => {
    const keepOnClose = () => {
      const trimmed = typed.current.text.trim();
      if (trimmed === "" || trimmed === typed.current.name) return;
      flushSync(() => {
        rename(trimmed);
      });
      saveNow();
    };
    window.addEventListener("pagehide", keepOnClose);
    return () => window.removeEventListener("pagehide", keepOnClose);
  }, [rename, saveNow]);

  function commit() {
    // A blank name is refused, and the box goes back to the name the deal has.
    if (rename(text)) setText(text.trim());
    else setText(name);
  }

  function commitOnEnter(event: KeyboardEvent) {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.target.blur();
  }

  return (
    <div onKeyDown={commitOnEnter} className="max-w-xl">
      <TextField label="Deal name" value={text} onChange={setText} onBlur={commit} />
    </div>
  );
}

const ROUTINE_STATUS = { saved: "Saved", pending: "Unsaved changes", saving: "Saving…" } as const;

/**
 * Where the deal's saving stands. The routine states are read where they are and never announced, since they change
 * with every keystroke; a failure is the one the owner must hear about, so it comes as an alert of its own.
 */
function SaveStatusText({ status }: { status: SaveStatus }) {
  if (status.kind !== "error") {
    return (
      <p key="status" className="m-0 text-sm text-muted">
        {ROUTINE_STATUS[status.kind]}
      </p>
    );
  }
  // The reason usually starts "Couldn't save — ", which the notice already says.
  const reason = withoutSavePrefix(status.message);
  return (
    <p key="failure" role="alert" className="m-0 text-sm font-semibold text-no-go">
      Couldn't save — retrying
      {reason ? <span className="font-normal">{`: ${reason}`}</span> : null}
    </p>
  );
}

/** The verdict, and while it is "Needs info" the first things the deal still needs, each linked to its step. */
function VerdictBlock({ dealId, evaluation }: { dealId: string; evaluation: DealEvaluation }) {
  const { verdict } = evaluation;
  const { shown, more } = topNeeds(verdict.missing);
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <VerdictChip kind={verdict.kind} size="lg" />
      {verdict.kind === "incomplete" && shown.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm sm:justify-end">
          <span className="font-semibold text-ink">Needs:</span>
          <ul className="m-0 flex list-none flex-wrap gap-x-3 p-0">
            {shown.map((item) => (
              <li key={item.message}>
                <Link to={`/deals/${dealId}/${stepForMissing(item)}`} className={`inline-flex min-h-11 items-center ${LINK}`}>
                  {needText(item)}
                </Link>
              </li>
            ))}
          </ul>
          {more > 0 ? <span className="text-muted">{`+${more} more`}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function SummaryStrip({ evaluation }: { evaluation: DealEvaluation }) {
  const summary = summarize(evaluation);
  return (
    <section aria-label="Deal summary" className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
      <StatTile label="Sale price (base)" value={formatMoney(summary.salePriceCents)} />
      <StatTile label="Total project cost" value={formatMoney(summary.totalProjectCostCents)} />
      <StatTile label="Profit" value={formatMoney(summary.profitCents)} />
      <StatTile label="Margin on sale" value={formatPercent(summary.marginOnSale)} />
      <StatTile label="Days on market" value={formatDayRange(summary.domLow, summary.domHigh)} />
    </section>
  );
}

function HeadsUp({ inputs, evaluation, today }: { inputs: DealInputs; evaluation: DealEvaluation; today: string }) {
  const messages = headsUp(inputs, evaluation, today);
  if (messages.length === 0) return null;
  return (
    <ul
      aria-label="Heads-up"
      className="m-0 flex list-none flex-col gap-1 rounded-lg border border-[#F0D9A8] bg-marginal-bg px-4 py-3 text-sm font-medium text-marginal"
    >
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

function StepTabs({ dealId }: { dealId: string }) {
  return (
    <nav aria-label="Deal steps" className="-mb-px flex flex-wrap gap-1">
      {STEPS.map((step, index) => (
        <NavLink
          key={step.path}
          to={`/deals/${dealId}/${step.path}`}
          aria-current="step"
          className={({ isActive }) =>
            `inline-flex min-h-11 items-center gap-2 border-b-[3px] px-4 text-[15px] no-underline ${focusRing} ${
              isActive ? "border-spruce font-semibold text-ink" : "border-transparent font-medium text-muted hover:text-ink"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span
                aria-hidden="true"
                className={`inline-flex size-[22px] items-center justify-center rounded-full text-xs ${
                  isActive ? "bg-spruce text-white" : "bg-[#E7E9E4] text-[#33403A]"
                }`}
              >
                {index + 1}
              </span>
              {step.title}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The engine threw on the deal as it is now (spec §8): the deal still shows as needing info, and this says why, with
 * what a bug report needs, and how to get the numbers back.
 */
function CalcFailure({ error }: { error: EvaluationError }) {
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-xl border border-[#F2C2BE] bg-no-go-bg px-4 py-2 text-no-go">
      <details>
        <summary className={`cursor-pointer rounded-md py-2.5 text-[17px] font-bold ${focusRing}`}>Couldn't calculate — details</summary>
        <p className="m-0 break-words text-sm">{error.message}</p>
        <p className="m-0 mt-1 mb-2 text-sm">{`Input hash ${error.inputHash}`}</p>
      </details>
      <p className="m-0 pb-2 text-sm">Undo your last change, or change an input to try again.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

interface ReadyProps {
  dealId: string;
  editor: DealEditor;
  name: string;
  inputs: DealInputs;
  evaluation: DealEvaluation;
  today: string;
}

function ReadyDeal({ dealId, editor, name, inputs, evaluation, today }: ReadyProps) {
  const { pathname } = useLocation();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-5 rounded-xl border border-line bg-surface px-5 pt-5 sm:px-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 basis-72 flex-col gap-2">
            <Link to="/deals" className={`inline-flex min-h-11 items-center self-start text-sm no-underline ${LINK}`}>
              ← Deals
            </Link>
            <DealNameField name={name} rename={editor.rename} saveNow={editor.saveNow} />
          </div>
          <CalcErrorBoundary input={inputs} resetOn={evaluation}>
            <VerdictBlock dealId={dealId} evaluation={evaluation} />
          </CalcErrorBoundary>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={editor.undo} disabled={!editor.canUndo} className={SMALL_BUTTON}>
            Undo
          </button>
          <button type="button" onClick={editor.redo} disabled={!editor.canRedo} className={SMALL_BUTTON}>
            Redo
          </button>
          <SaveStatusText status={editor.saveStatus} />
        </div>

        <CalcErrorBoundary input={inputs} resetOn={evaluation}>
          <SummaryStrip evaluation={evaluation} />
          <HeadsUp inputs={inputs} evaluation={evaluation} today={today} />
        </CalcErrorBoundary>

        <StepTabs dealId={dealId} />
      </div>

      {editor.evaluationError ? <CalcFailure error={editor.evaluationError} /> : null}

      {/* A step that cannot draw is replaced by the message; the header and the tabs stay, so the owner can move on. */}
      <CalcErrorBoundary key={pathname} input={inputs} resetOn={evaluation}>
        <Outlet />
      </CalcErrorBoundary>
    </div>
  );
}

/**
 * The frame every step of a deal is drawn in: the name, verdict and what is still needed, undo and redo, the save
 * status, the summary figures, the heads-up warnings and the step tabs, with the step's own screen below. Its state
 * comes from the deal's editor (`DealRoute` provides it).
 */
export function DealLayout({ dealId }: { dealId: string }) {
  const editor = useDealEditorContext();
  const { status, deal, inputs, evaluation, context } = editor;

  if (status === "notFound") return <DealNotFound />;
  if (status === "error") {
    return <DealUnreadable dealId={dealId} message={editor.error?.message ?? "Unknown error"} />;
  }
  if (status !== "ready" || !deal || !inputs || !evaluation || !context) return <DealSkeleton />;
  return (
    <ReadyDeal
      dealId={dealId}
      editor={editor}
      name={deal.name}
      inputs={inputs}
      evaluation={evaluation}
      today={context.today}
    />
  );
}
