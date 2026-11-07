import { useId } from "react";
import type { ReactNode } from "react";

/** The `<table>` rules every table of the package shares. */
export const PRINT_TABLE = "w-full border-collapse text-sm";
export const PRINT_ROW = "print-row border-b border-line last:border-b-0";
export const HEAD_CELL = "px-2 py-2 text-xs font-semibold text-muted";
export const CELL = "px-2 py-2 text-right align-top";
export const ROW_HEAD = "px-2 py-2 text-left align-top font-medium";

/** One numbered-by-heading block of the package: a named region with an `h2`, kept whole on the page. */
export function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="print-block flex flex-col gap-3 border-t border-line pt-5 first:border-t-0 first:pt-0"
    >
      <h2 id={titleId} className="m-0 text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Labelled values in a list; each pair reads "label, value". */
export function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-x-6 gap-y-2 text-sm">
      {children}
    </dl>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="print-row flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 font-semibold">{children}</dd>
    </div>
  );
}

/** A table's box: it scrolls sideways on a phone so the page never does, and prints at full width. */
export function TableBox({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto print:overflow-visible">{children}</div>;
}
