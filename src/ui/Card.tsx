import { useId, type ReactNode } from "react";

export interface CardProps {
  title: string;
  /** Sits at the top right, beside the title. */
  actions?: ReactNode;
  children: ReactNode;
}

/** A white panel with a heading. It is a named region, so a screen reader can jump between cards. */
export function Card({ title, actions, children }: CardProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="m-0 text-[17px] font-bold">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
