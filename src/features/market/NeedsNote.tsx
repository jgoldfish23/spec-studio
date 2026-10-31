import type { ReactNode } from "react";

/** What a card says in place of its figures while the engine cannot work them out. */
export function NeedsNote({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-lg border border-dashed border-[#B8BEB9] bg-paper px-4 py-3 text-sm text-muted">
      {children}
    </p>
  );
}
