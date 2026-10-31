import type { ReactNode } from "react";

export interface StatTileProps {
  label: string;
  value: ReactNode;
}

/** One figure with its label, e.g. "Profit" over "$161,500". Each tile is its own one-item description list. */
export function StatTile({ label, value }: StatTileProps) {
  return (
    <dl className="m-0 rounded-[10px] bg-[#F7F8F6] px-3.5 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 mt-1 text-xl font-bold text-ink">{value}</dd>
    </dl>
  );
}
