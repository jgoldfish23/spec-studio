import type { GridCell } from "@engine";
import { formatDays, formatMoney, formatPercent } from "../../lib/format";
import { Card } from "../../ui/Card";
import { BAND_ORDER, BAND_STYLES } from "./gridPalette";

/** The base case's outline: a shape, so it shows without color. */
const BASE_OUTLINE = "outline-solid outline-3 -outline-offset-3 outline-ink";

/** The row's name: how far the price is from the base price, and the price itself. The profit in each cell is the engine's. */
function priceLabel(priceDelta: number, basePriceCents: number): string {
  const price = formatMoney(Math.round(basePriceCents * (1 + priceDelta)));
  return priceDelta === 0 ? `Base · ${price}` : `${formatPercent(priceDelta, 0, { signed: true })} · ${price}`;
}

function Legend() {
  return (
    <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-xs text-muted">
      {BAND_ORDER.map((band) => (
        <li key={band} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-3.5 flex-none rounded-xs border border-black/10"
            style={{ backgroundColor: BAND_STYLES[band].background }}
          />
          {BAND_STYLES[band].label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="box-border size-3.5 flex-none rounded-xs border-[3px] border-ink" />
        Base case
      </li>
    </ul>
  );
}

interface ProfitGridCardProps {
  /** The engine's grid: a row for each sale price step, a column for each number of days on market. */
  grid: readonly (readonly GridCell[])[];
  basePriceCents: number;
  /** The base case's break-even days on market; null when profit outlasts the longest the engine tries. */
  breakEvenDomDays: number | null;
}

/**
 * Profit at five sale prices and five stays on the market, colored by band, with the base case outlined, a legend, and
 * how long the house could sit at full price before the profit is gone. It is built on the base case, so it does not
 * change with the scenario picked.
 */
export function ProfitGridCard({ grid, basePriceCents, breakEvenDomDays }: ProfitGridCardProps) {
  const columns = grid[0] ?? [];
  // 0 days is the engine saying the deal already loses money at full price, however fast it sells.
  const sits =
    breakEvenDomDays === 0
      ? "At full price it loses money even if it sells right away"
      : `At full price it could sit ${breakEvenDomDays === null ? "more than 3 years" : `about ${formatDays(breakEvenDomDays)}`} before profit hits $0`;
  return (
    <Card title="Profit by sale price × days on market">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
          <caption className="sr-only">Profit by sale price and days on market</caption>
          <thead>
            <tr>
              <th scope="col" className="p-2 text-left text-xs font-semibold text-muted">
                Sale price ↓ / Days →
              </th>
              {columns.map((cell) => (
                <th key={cell.domDays} scope="col" className="p-2 text-[13px] font-semibold text-[#33403A]">
                  {formatDays(cell.domDays)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => {
              const first = row[0];
              if (first === undefined) return null;
              return (
                <tr key={first.priceDelta}>
                  <th scope="row" className="whitespace-nowrap p-2 text-left text-[13px] font-semibold text-[#33403A]">
                    {priceLabel(first.priceDelta, basePriceCents)}
                  </th>
                  {row.map((cell) => {
                    const { background, color } = BAND_STYLES[cell.band];
                    return (
                      <td
                        key={cell.domDays}
                        aria-current={cell.isBase ? "true" : undefined}
                        className={`rounded-md px-2 py-3 text-center font-semibold ${cell.isBase ? BASE_OUTLINE : ""}`}
                        style={{ backgroundColor: background, color }}
                      >
                        {formatMoney(cell.profitCents)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Legend />
      <p className="m-0 rounded-lg bg-[#F7F8F6] px-3.5 py-3 text-[13px] leading-normal text-[#33403A]">
        {sits}
      </p>
    </Card>
  );
}
