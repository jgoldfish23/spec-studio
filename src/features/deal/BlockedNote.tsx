import { Link } from "react-router";
import type { MissingItem } from "@engine";
import { needText } from "./needText";
import { FOCUS_RING } from "./stepShared";
import { STEPS } from "./steps";
import { stepForMissing } from "./summary";

const LINK = `inline-flex min-h-11 items-center font-semibold text-spruce underline underline-offset-2 ${FOCUS_RING}`;

/**
 * Stands in for a figure the estimate would give, when a problem with the deal stops the estimate (see
 * `estimateBlocker`): "Fix City: Required on Lot to see the estimate", linked to the step that fixes it.
 */
export function BlockedNote({ dealId, item }: { dealId: string; item: MissingItem }) {
  const step = stepForMissing(item);
  const title = STEPS.find((candidate) => candidate.path === step)?.title ?? step;
  return (
    <p className="m-0 text-sm">
      <Link to={`/deals/${dealId}/${step}`} className={LINK}>
        {`Fix ${needText(item)} on ${title} to see the estimate`}
      </Link>
    </p>
  );
}
