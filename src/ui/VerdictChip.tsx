import type { ReactNode } from "react";
import type { VerdictKind } from "@engine";

export interface VerdictChipProps {
  kind: VerdictKind;
  size?: "sm" | "lg";
}

// Each verdict is a word plus an icon, never a color alone. The icons are decoration: the word says it.
const ICONS: Record<VerdictKind, ReactNode> = {
  go: <path d="M3 7.5 6 10l5-6" />,
  marginal: <path d="M3.5 7h7" />,
  nogo: <path d="m4 4 6 6M10 4l-6 6" />,
  incomplete: <path d="M5.4 5.4a1.7 1.7 0 1 1 2.4 1.6c-.5.3-.8.6-.8 1.2M7 10.4v.1" />,
};

const VERDICTS: Record<VerdictKind, { text: string; classes: string }> = {
  go: { text: "Go", classes: "border-[#B9DEC7] bg-go-bg text-go" },
  marginal: { text: "Marginal", classes: "border-[#F0D9A8] bg-marginal-bg text-marginal" },
  nogo: { text: "No-go", classes: "border-[#F2C2BE] bg-no-go-bg text-no-go" },
  incomplete: { text: "Needs info", classes: "border-dashed border-[#B8BEB9] bg-paper text-muted" },
};

const SIZES = {
  sm: { box: "gap-1.5 px-2.5 py-1 text-[13px] font-semibold", icon: 14 },
  lg: { box: "gap-2.5 px-[18px] py-2.5 text-[22px] font-extrabold uppercase tracking-[0.02em]", icon: 20 },
} as const;

/** The deal's verdict as a pill: "Go", "Marginal", "No-go" or "Needs info". */
export function VerdictChip({ kind, size = "sm" }: VerdictChipProps) {
  const { text, classes } = VERDICTS[kind];
  const { box, icon } = SIZES[size];
  return (
    <span className={`inline-flex items-center rounded-full border ${box} ${classes}`}>
      <svg
        aria-hidden="true"
        width={icon}
        height={icon}
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        {ICONS[kind]}
      </svg>
      {text}
    </span>
  );
}
