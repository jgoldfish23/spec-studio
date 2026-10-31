import { useId } from "react";
import type { ReactNode } from "react";
import type { Bid, Estimate, EstimateLine, LinePart } from "@engine";
import { formatMoney, formatPercentCompact } from "../../lib/format";
import { SourceBadge } from "../../ui/SourceBadge";
import { TIER_NAMES } from "../house/shared";
import { BidForm } from "./BidForm";
import {
  DIVISION_NAMES,
  formatAsOf,
  formatQuantity,
  groupByDivision,
  quantityText,
  unitCostText,
  variantName,
} from "./lineFormat";
import { ACTION_BUTTON } from "./shared";

/** Which lines the table lists. */
export type LineFilter = "all" | "defaults";

/** Where focus goes when a bid form closes: the button that opened it, or the line's name (which always stays put). */
export type FocusTarget = "trigger" | "name";

/** The columns of the table, which the rows that span it have to know. */
const COLUMNS = 6;

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";
const HEADER_CELL = "px-3 py-2.5 font-semibold";
const MISSING = "—";

/** A part's finish tier in words, or a dash for a part that has none. */
const tierName = (tier: LinePart["tier"]): string => (tier === null ? MISSING : TIER_NAMES[tier]);

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="M5 3l4 4-4 4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// What a line expands to

const PART_HEAD = "py-1.5 pr-3 text-left text-xs font-semibold uppercase tracking-[0.04em] text-muted";
const PART_CELL = "py-2 pr-3 align-top";

/** A priced line's parts: what each was costed at, and where that price came from. */
function PartsTable({ line }: { line: EstimateLine }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label={`${line.name} parts`} className="w-full min-w-[600px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={PART_HEAD}>
              Variant
            </th>
            <th scope="col" className={PART_HEAD}>
              Tier
            </th>
            <th scope="col" className={PART_HEAD}>
              Quantity
            </th>
            <th scope="col" className={`${PART_HEAD} text-right`}>
              Unit price
            </th>
            <th scope="col" className={`${PART_HEAD} text-right`}>
              Total
            </th>
            <th scope="col" className={`${PART_HEAD} pl-6`}>
              Source
            </th>
            <th scope="col" className={PART_HEAD}>
              As of
            </th>
          </tr>
        </thead>
        <tbody>
          {line.parts.map((part, index) => (
            <tr key={`${part.variant}/${part.tier ?? "none"}/${index}`} className="border-t border-[#E3E6E0]">
              <td className={PART_CELL}>{variantName(part.variant)}</td>
              <td className={PART_CELL}>{tierName(part.tier)}</td>
              <td className={PART_CELL}>{formatQuantity(part.quantity, part.unit)}</td>
              <td className={`${PART_CELL} text-right`}>{formatMoney(part.unitPriceCents, { cents: true })}</td>
              <td className={`${PART_CELL} text-right font-semibold`}>{formatMoney(part.totalCents)}</td>
              <td className={`${PART_CELL} pl-6`}>
                <SourceBadge source={part.source} stale={part.stale} />
              </td>
              <td className={PART_CELL}>{formatAsOf(part.asOf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A bid line's takeoff: the quantities the house needs, which the bid covers and no price is worked from. */
function TakeoffTable({ line }: { line: EstimateLine }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label={`${line.name} takeoff`} className="w-full min-w-[320px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={PART_HEAD}>
              Variant
            </th>
            <th scope="col" className={PART_HEAD}>
              Tier
            </th>
            <th scope="col" className={PART_HEAD}>
              Quantity
            </th>
          </tr>
        </thead>
        <tbody>
          {line.takeoff.map((part, index) => (
            <tr key={`${part.variant}/${part.tier ?? "none"}/${index}`} className="border-t border-[#E3E6E0]">
              <td className={PART_CELL}>{variantName(part.variant)}</td>
              <td className={PART_CELL}>{tierName(part.tier)}</td>
              <td className={PART_CELL}>{formatQuantity(part.quantity, part.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BidDetails({ line }: { line: EstimateLine }) {
  const { bid } = line;
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm font-semibold">Priced by bid</p>
      {bid ? (
        <p className="m-0 text-[13px] text-muted">{`${bid.vendor}, received ${formatAsOf(bid.receivedOn)}`}</p>
      ) : null}
      {bid?.notes ? <p className="m-0 text-[13px] text-muted">{`Notes: ${bid.notes}`}</p> : null}
      {line.takeoff.length > 0 ? (
        <TakeoffTable line={line} />
      ) : (
        <p className="m-0 text-[13px] text-muted">The takeoff has no quantity for this line.</p>
      )}
    </div>
  );
}

/**
 * A row that spans the table, for what opens under a line. Its content is as wide as the box the table scrolls in
 * (`100cqw`) and stays at the left edge while the table is scrolled, so on a phone it is never off-screen.
 */
function SpanningRow({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <tr id={id} className="bg-[#F7F8F6]">
      <td colSpan={COLUMNS} className="p-0">
        <div className="sticky left-0 w-[100cqw] px-3 py-3">{children}</div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The rows

interface LineRowsProps {
  line: EstimateLine;
  open: boolean;
  formOpen: boolean;
  onToggle: () => void;
  onOpenForm: () => void;
  onCloseForm: (target: FocusTarget) => void;
  onSaveBid: (bid: Bid) => void;
  onRemoveBid: () => void;
}

/** A cost line, then (when they are open) its parts and its bid form. */
function LineRows({ line, open, formOpen, onToggle, onOpenForm, onCloseForm, onSaveBid, onRemoveBid }: LineRowsProps) {
  const uid = useId();
  const nameId = `${uid}-name`;
  const partsId = `${uid}-parts`;
  const isBid = line.source === "bid";
  return (
    <>
      <tr className="border-t border-[#EEF0EC] align-middle">
        <th scope="row" className="px-3 py-1 text-left font-medium">
          <button
            id={nameId}
            type="button"
            data-focus={`name:${line.code}`}
            aria-expanded={open}
            aria-controls={open ? partsId : undefined}
            onClick={onToggle}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-left font-medium hover:underline ${FOCUS_RING}`}
          >
            <Chevron open={open} />
            {line.name}
          </button>
        </th>
        <td className="px-3 py-3 text-muted">{quantityText(line)}</td>
        <td className="px-3 py-3 text-right text-muted">{unitCostText(line)}</td>
        <td className="px-3 py-3 text-right font-semibold">{formatMoney(line.totalCents)}</td>
        <td className="px-3 py-3">
          <SourceBadge source={line.source} stale={line.stale} />
        </td>
        <td className="px-3 py-1 text-right">
          {isBid ? (
            <div className="flex flex-wrap justify-end gap-x-1">
              <button
                type="button"
                data-focus={`trigger:${line.code}`}
                aria-describedby={nameId}
                onClick={onOpenForm}
                className={ACTION_BUTTON}
              >
                Edit bid
              </button>
              <button type="button" aria-describedby={nameId} onClick={onRemoveBid} className={ACTION_BUTTON}>
                Remove bid
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-focus={`trigger:${line.code}`}
              aria-describedby={nameId}
              onClick={onOpenForm}
              className={ACTION_BUTTON}
            >
              Add bid
            </button>
          )}
        </td>
      </tr>
      {open ? (
        <SpanningRow id={partsId}>{isBid ? <BidDetails line={line} /> : <PartsTable line={line} />}</SpanningRow>
      ) : null}
      {formOpen ? (
        <SpanningRow>
          <BidForm
            code={line.code}
            codeName={line.name}
            bid={line.bid}
            onSave={onSaveBid}
            onCancel={() => onCloseForm("trigger")}
          />
        </SpanningRow>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export interface CostTableProps {
  estimate: Estimate;
  filter: LineFilter;
  /** The codes of the lines whose parts are showing. */
  expanded: ReadonlySet<string>;
  /** The code of the line whose bid form is open. */
  openForm: string | null;
  onToggle: (code: string) => void;
  onOpenForm: (code: string) => void;
  onCloseForm: (code: string, target: FocusTarget) => void;
  onSaveBid: (bid: Bid) => void;
  onRemoveBid: (code: string) => void;
}

/**
 * The estimate's cost lines grouped by division, each division with its subtotal, and the whole estimate's subtotal,
 * contingency and total at the foot. The filter changes which lines are listed, never the totals: those are the
 * engine's, for the whole estimate. The table scrolls sideways inside its own box on a narrow screen.
 */
export function CostTable({
  estimate,
  filter,
  expanded,
  openForm,
  onToggle,
  onOpenForm,
  onCloseForm,
  onSaveBid,
  onRemoveBid,
}: CostTableProps) {
  const shown = filter === "defaults" ? estimate.lines.filter((line) => line.source === "default") : estimate.lines;
  const groups = groupByDivision(shown);
  // `relative` so the screen-reader-only text inside (positioned absolutely) is clipped by the scroll box too, instead
  // of sitting outside it and widening the page.
  return (
    <div className="@container relative overflow-x-auto">
      <table aria-label="Cost lines by division" className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="bg-[#F7F8F6] text-left text-xs uppercase tracking-[0.04em] text-muted">
            <th scope="col" className={HEADER_CELL}>
              Line
            </th>
            <th scope="col" className={HEADER_CELL}>
              Quantity
            </th>
            <th scope="col" className={`${HEADER_CELL} text-right`}>
              Unit cost
            </th>
            <th scope="col" className={`${HEADER_CELL} text-right`}>
              Total
            </th>
            <th scope="col" className={HEADER_CELL}>
              Price source
            </th>
            <th scope="col" className={HEADER_CELL}>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        {groups.map(({ division, lines }) => (
          <tbody key={division}>
            <tr className="border-t border-line bg-[#F1F3EF]">
              <th scope="rowgroup" colSpan={3} className="px-3 py-2.5 text-left text-[13px] font-bold text-[#33403A]">
                {DIVISION_NAMES[division]}
              </th>
              <td className="px-3 py-2.5 text-right text-[13px] font-bold text-[#33403A]">
                {formatMoney(estimate.divisionSubtotals[division])}
              </td>
              <td colSpan={2} />
            </tr>
            {lines.map((line) => (
              <LineRows
                key={line.code}
                line={line}
                open={expanded.has(line.code)}
                formOpen={openForm === line.code}
                onToggle={() => onToggle(line.code)}
                onOpenForm={() => onOpenForm(line.code)}
                onCloseForm={(target) => onCloseForm(line.code, target)}
                onSaveBid={onSaveBid}
                onRemoveBid={() => onRemoveBid(line.code)}
              />
            ))}
          </tbody>
        ))}
        {groups.length === 0 ? (
          <tbody>
            <tr className="border-t border-line">
              <td colSpan={COLUMNS} className="px-3 py-4 text-muted">
                No line is priced from a starter default.
              </td>
            </tr>
          </tbody>
        ) : null}
        <tfoot>
          <tr className="border-t-2 border-ink">
            <th scope="row" colSpan={2} className="px-3 py-3 text-left">
              Subtotal
            </th>
            <td />
            <td className="px-3 py-3 text-right font-bold">{formatMoney(estimate.subtotalCents)}</td>
            <td colSpan={2} />
          </tr>
          <tr>
            <th scope="row" colSpan={2} className="px-3 pb-3 pt-1 text-left font-medium text-muted">
              Contingency
            </th>
            <td className="px-3 pb-3 pt-1 text-right text-muted">{formatPercentCompact(estimate.contingencyPct, 2)}</td>
            <td className="px-3 pb-3 pt-1 text-right font-semibold">{formatMoney(estimate.contingencyCents)}</td>
            <td colSpan={2} />
          </tr>
          <tr className="bg-[#F1F3EF]">
            <th scope="row" colSpan={2} className="px-3 py-3.5 text-left text-base">
              Build estimate
            </th>
            <td />
            <td className="px-3 py-3.5 text-right text-base font-bold">{formatMoney(estimate.totalCents)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
