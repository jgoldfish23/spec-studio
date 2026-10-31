const MISSING = "—";
const STYLES: Readonly<Record<string, string>> = { rambler: "rambler", twoStory: "two-story", multiLevel: "multi-level" };
const ADUS: Readonly<Record<string, string>> = { basement: "basement ADU", detached: "detached ADU" };
const SQUARE_FEET = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** A usable measurement: a finite number, not negative. */
const amount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** A name from a fixed list, or null for anything else (a missing field, a name this version does not know). */
const named = (list: Readonly<Record<string, string>>, value: unknown): string | null =>
  typeof value === "string" && Object.hasOwn(list, value) ? (list[value] as string) : null;

/**
 * A deal's house in a few words for the deals list, like "3,800 sf rambler · finished basement · 3-car": finished
 * area, style, basement, garage, and an ADU if there is one. It reads a stored deal's house as it comes, so every
 * part is checked, and a part that is missing or does not make sense is left out. "—" when nothing is left.
 */
export function houseLine(house: unknown): string {
  const h = record(house);
  if (h === null) return MISSING;
  const levels = record(h.levels);
  const basement = record(levels?.basement);

  const areas = [record(levels?.main)?.finishedSf, record(levels?.upper)?.finishedSf, basement?.finishedSf]
    .map(amount)
    .filter((sf) => sf !== null);
  const totalSf = areas.reduce((sum, sf) => sum + sf, 0);
  const style = named(STYLES, h.style);
  const size = areas.length > 0 && totalSf > 0 ? `${SQUARE_FEET.format(totalSf)} sf` : null;

  const basementFinished = amount(basement?.finishedSf);
  const basementTotal = amount(basement?.totalSf);
  const hasBasement = basementFinished !== null && (basementFinished > 0 || (basementTotal ?? 0) > 0);
  const basementPart = !hasBasement ? null : basementFinished > 0 ? "finished basement" : "unfinished basement";

  const bays = amount(record(h.garage)?.bays);

  return (
    [
      [size, style].filter((part) => part !== null).join(" "),
      basementPart,
      bays !== null && Number.isInteger(bays) && bays > 0 ? `${bays}-car` : null,
      named(ADUS, record(h.adu)?.type),
    ]
      .filter((part) => part !== null && part !== "")
      .join(" · ") || MISSING
  );
}
