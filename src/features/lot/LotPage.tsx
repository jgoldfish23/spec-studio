import { useId } from "react";
import { UtilitySchema, UtilityStatusSchema } from "@engine";
import type { DealEvaluation, DealInputs, Utility, UtilityStatus } from "@engine";
import { Card } from "../../ui/Card";
import {
  MonthField,
  MoneyField,
  NumberField,
  OptionalNumberField,
  PercentField,
  TextField,
} from "../../ui/fields";
import { useDealEditorContext } from "../deal/DealEditorContext";
import { fieldError } from "../deal/fieldErrors";
import { SegmentedField } from "../deal/SegmentedField";
import type { DealEditor } from "../deal/useDealEditor";
import { LotSidePanel } from "./LotSidePanel";

/** The most a lot price may be: the engine's cap, $100 million. */
const MAX_PRICE_CENTS = 10_000_000_000;

/** What "Land loan" starts as. */
const DEFAULT_LAND_LOAN = { kind: "loan", ltv: 0.7, rate: 0.1, points: 0.01 } as const;

const REGIONS = [{ value: "utah-north", label: "Northern Utah (Davis & Weber)" }];

const UTILITY_NAMES: Record<Utility, string> = {
  water: "Water",
  sewer: "Sewer",
  gas: "Gas",
  power: "Power",
  secondaryWater: "Secondary water",
};

const UTILITY_STATUS_NAMES: Record<UtilityStatus, string> = {
  available: "Available",
  needsConnection: "Needs connection",
  unknown: "Unknown",
};

const UTILITY_OPTIONS = UtilityStatusSchema.options.map((value) => ({ value, label: UTILITY_STATUS_NAMES[value] }));

/** Boxes in a row, wrapping to a column on a phone. */
const FIELD_GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4";

type Edit = DealEditor["edit"];

/** The deal's name, shown as text: it is renamed in the header, so this box takes no input. */
function NameDisplay({ name }: { name: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-[#33403A]">
        Address / name
      </label>
      <input
        id={id}
        readOnly
        value={name}
        aria-describedby={hintId}
        className="min-h-11 min-w-0 rounded-lg border border-[#C9CEC8] bg-[#F7F8F6] px-3 py-2.5 font-[inherit] text-[15px] text-ink"
      />
      <p id={hintId} className="m-0 text-xs text-muted">
        Change the name at the top of the page
      </p>
    </div>
  );
}

interface SectionProps {
  inputs: DealInputs;
  evaluation: DealEvaluation;
  edit: Edit;
}

function LotCard({ inputs, evaluation, edit, name }: SectionProps & { name: string }) {
  const { lot } = inputs;
  const error = (path: string) => fieldError(evaluation, path);
  return (
    <Card title="The lot">
      <div className={FIELD_GRID}>
        <NameDisplay name={name} />
        <TextField
          label="City"
          value={lot.city}
          onChange={(city) => edit((draft) => void (draft.lot.city = city))}
          error={error("lot.city")}
        />
        <TextField
          label="County"
          value={lot.county}
          onChange={(county) => edit((draft) => void (draft.lot.county = county))}
          error={error("lot.county")}
        />
        <SegmentedField
          label="Region"
          options={REGIONS}
          value={lot.region}
          onChange={(region) => edit((draft) => void (draft.lot.region = region))}
          error={error("lot.region")}
        />
        <NumberField
          label="Acres"
          unit="ac"
          min={0}
          value={lot.acres}
          onChange={(acres) => edit((draft) => void (draft.lot.acres = acres))}
          error={error("lot.acres")}
        />
        <OptionalNumberField
          label="Frontage"
          unit="ft"
          min={0}
          value={lot.frontageFt}
          onChange={(feet) =>
            edit((draft) => {
              if (feet === undefined) delete draft.lot.frontageFt;
              else draft.lot.frontageFt = feet;
            })
          }
          error={error("lot.frontageFt")}
        />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-[13px] font-semibold text-[#33403A]">Utilities at the street</h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
          {UtilitySchema.options.map((utility) => (
            <SegmentedField
              key={utility}
              label={UTILITY_NAMES[utility]}
              options={UTILITY_OPTIONS}
              value={lot.utilities[utility]}
              onChange={(status) => edit((draft) => void (draft.lot.utilities[utility] = status))}
              error={error(`lot.utilities.${utility}`)}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

function PriceCard({ inputs, evaluation, edit }: SectionProps) {
  const { financing } = inputs.lot;
  const error = (path: string) => fieldError(evaluation, path);

  function payWith(kind: "cash" | "loan") {
    edit((draft) => {
      if (kind === "cash") draft.lot.financing = { kind: "cash" };
      // The control does not fire for the option already chosen, but the deal may have changed since the click.
      // Either way a loan that is there keeps the terms already typed.
      else if (draft.lot.financing.kind !== "loan") draft.lot.financing = { ...DEFAULT_LAND_LOAN };
    });
  }

  /** Sets one term of the land loan, if the deal still has one. */
  function setTerm(term: "ltv" | "rate" | "points", value: number) {
    edit((draft) => {
      if (draft.lot.financing.kind === "loan") draft.lot.financing[term] = value;
    });
  }

  return (
    <Card title="Price & closing">
      <div className={FIELD_GRID}>
        <MoneyField
          label="Lot price"
          min={0}
          max={MAX_PRICE_CENTS}
          valueCents={inputs.lot.priceCents}
          onChange={(cents) => edit((draft) => void (draft.lot.priceCents = cents))}
          error={error("lot.priceCents")}
        />
        <MoneyField
          label="Closing costs"
          min={0}
          valueCents={inputs.lot.closingCents}
          onChange={(cents) => edit((draft) => void (draft.lot.closingCents = cents))}
          error={error("lot.closingCents")}
        />
        <SegmentedField
          label="Pay for land with"
          options={[
            { value: "cash", label: "Cash" },
            { value: "loan", label: "Land loan" },
          ]}
          value={financing.kind}
          onChange={payWith}
          // A loan's own boxes show what is wrong with it; the group speaks only when they are not there.
          error={financing.kind === "loan" ? undefined : error("lot.financing")}
        />
      </div>
      {financing.kind === "loan" ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-4">
          <PercentField
            label="LTV %"
            min={0}
            max={1}
            value={financing.ltv}
            onChange={(value) => setTerm("ltv", value)}
            error={error("lot.financing.ltv")}
          />
          <PercentField
            label="Rate %"
            min={0}
            max={1}
            value={financing.rate}
            onChange={(value) => setTerm("rate", value)}
            error={error("lot.financing.rate")}
          />
          <PercentField
            label="Points %"
            min={0}
            max={1}
            value={financing.points}
            onChange={(value) => setTerm("points", value)}
            error={error("lot.financing.points")}
          />
        </div>
      ) : null}
    </Card>
  );
}

function CarryingCard({ inputs, evaluation, edit }: SectionProps) {
  const error = (path: string) => fieldError(evaluation, path);
  return (
    <Card title="City & carrying">
      <div className={FIELD_GRID}>
        <PercentField
          label="Property tax rate %"
          hint="Default for Northern Utah · verify with the county"
          min={0}
          max={1}
          value={inputs.lot.propertyTaxRate}
          onChange={(rate) => edit((draft) => void (draft.lot.propertyTaxRate = rate))}
          error={error("lot.propertyTaxRate")}
        />
        <MoneyField
          label="HOA $/month"
          min={0}
          valueCents={inputs.lot.hoaMonthlyCents}
          onChange={(cents) => edit((draft) => void (draft.lot.hoaMonthlyCents = cents))}
          error={error("lot.hoaMonthlyCents")}
        />
      </div>
    </Card>
  );
}

function TimelineCard({ inputs, evaluation, edit }: SectionProps) {
  const { timeline } = inputs;
  const error = (path: string) => fieldError(evaluation, path);
  const listsEarly = timeline.listEarlyMonths !== 0;
  // The limit is the build length, once that is a usable number; until then the engine says what is wrong with it.
  const { buildMonths } = timeline;
  const earliestList = Number.isInteger(buildMonths) && buildMonths >= 1 ? buildMonths : undefined;

  function listAt(early: boolean) {
    edit((draft) => {
      if (!early) draft.timeline.listEarlyMonths = 0;
      // A start the field accepts, so the months box does not open on a value it would refuse.
      else if (draft.timeline.listEarlyMonths === 0) draft.timeline.listEarlyMonths = 1;
    });
  }

  return (
    <Card title="Timeline">
      <div className={FIELD_GRID}>
        <MonthField
          label="Land closes"
          value={timeline.landClose}
          onChange={(month) => edit((draft) => void (draft.timeline.landClose = month))}
          error={error("timeline.landClose")}
        />
        <NumberField
          label="Design & permits months"
          hint="Whole months"
          integer
          min={0}
          max={36}
          value={timeline.preConMonths}
          onChange={(months) => edit((draft) => void (draft.timeline.preConMonths = months))}
          error={error("timeline.preConMonths")}
        />
        <NumberField
          label="Build months"
          hint="Whole months"
          integer
          min={1}
          max={36}
          value={timeline.buildMonths}
          onChange={(months) => edit((draft) => void (draft.timeline.buildMonths = months))}
          error={error("timeline.buildMonths")}
        />
        <NumberField
          label="Closing days after contract"
          hint="Whole days"
          integer
          min={0}
          max={180}
          value={timeline.closingDays}
          onChange={(days) => edit((draft) => void (draft.timeline.closingDays = days))}
          error={error("timeline.closingDays")}
        />
        <SegmentedField
          label="List for sale"
          options={[
            { value: "after", label: "At completion" },
            { value: "before", label: "Before completion" },
          ]}
          value={listsEarly ? "before" : "after"}
          onChange={(when) => listAt(when === "before")}
          // The months box shows the message when it is there.
          error={listsEarly ? undefined : error("timeline.listEarlyMonths")}
        />
        {listsEarly ? (
          <NumberField
            label="Months before completion"
            hint="Whole months"
            integer
            min={1}
            max={earliestList}
            value={timeline.listEarlyMonths}
            onChange={(months) => edit((draft) => void (draft.timeline.listEarlyMonths = months))}
            error={error("timeline.listEarlyMonths")}
          />
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Step 1 of 5: the lot. Four cards of fields on the left (what the lot is, what it costs and how it is paid for, the
 * city's tax and the HOA, and the timeline), and what the lot adds up to on the right. Every field writes the deal
 * through the editor; the messages under the fields are the engine's own.
 */
export function LotPage() {
  const { status, deal, inputs, evaluation, edit } = useDealEditorContext();
  // The layout draws the loading, not-found and error states; this screen is only ever shown for a ready deal.
  if (status !== "ready" || deal === undefined || inputs === undefined || evaluation === undefined) return null;
  return (
    <div className="flex flex-wrap items-start gap-6">
      <h1 className="sr-only">Lot</h1>
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
        <LotCard inputs={inputs} evaluation={evaluation} edit={edit} name={deal.name} />
        <PriceCard inputs={inputs} evaluation={evaluation} edit={edit} />
        <CarryingCard inputs={inputs} evaluation={evaluation} edit={edit} />
        <TimelineCard inputs={inputs} evaluation={evaluation} edit={edit} />
      </div>
      <LotSidePanel dealId={deal.id} lot={inputs.lot} evaluation={evaluation} />
    </div>
  );
}
