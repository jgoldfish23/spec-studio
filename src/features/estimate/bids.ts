import { BidSchema } from "@engine";
import type { Bid, Cents, ISODate } from "@engine";

/**
 * The bids with `bid` as the only one for its cost code: any bids already there for the code are replaced (the first
 * one's place is kept, so the others stay in their order), and a code with no bid yet is added at the end. The list
 * and the bids in it are not changed; the result is a new array.
 */
export function upsertBid(bids: readonly Bid[], bid: Bid): Bid[] {
  const result: Bid[] = [];
  let placed = false;
  for (const existing of bids) {
    if (existing.code !== bid.code) {
      result.push(existing);
    } else if (!placed) {
      result.push(bid);
      placed = true;
    }
  }
  if (!placed) result.push(bid);
  return result;
}

/** The bids without any for the cost code `code`. The list is not changed; the result is a new array. */
export function removeBid(bids: readonly Bid[], code: string): Bid[] {
  return bids.filter((bid) => bid.code !== code);
}

/** What a bid form holds before it is a `Bid`: the amount is empty until one is typed. */
export interface BidDraft {
  vendor: string;
  amountCents: Cents | undefined;
  receivedOn: ISODate;
}

/** The message for each field of a bid draft that cannot be saved. A field that is fine has no entry. */
export interface BidProblems {
  vendor?: string;
  amount?: string;
  receivedOn?: string;
}

/**
 * What is wrong with a bid draft: a vendor must be filled in, the amount must be above $0, and the date must be one
 * the engine accepts (it says why when it does not, so the form and the engine never disagree).
 */
export function bidProblems({ vendor, amountCents, receivedOn }: BidDraft): BidProblems {
  const problems: BidProblems = {};
  if (vendor.trim() === "") problems.vendor = "Vendor is required";
  if (amountCents === undefined || !Number.isFinite(amountCents) || amountCents <= 0) {
    problems.amount = "Enter an amount above $0";
  }
  const date = BidSchema.shape.receivedOn.safeParse(receivedOn);
  if (!date.success) problems.receivedOn = date.error.issues[0]?.message ?? "Enter a date";
  return problems;
}
