import { useId, type ReactNode } from "react";

export interface CardProps {
  title: string;
  /** Sits at the top right, beside the title. */
  actions?: ReactNode;
  /** The level of the title's heading: 2 unless the card sits under a heading of its own, when 3. */
  headingLevel?: 2 | 3;
  children: ReactNode;
}

/** A white panel with a heading. It is a named region, so a screen reader can jump between cards. */
export function Card({ title, actions, headingLevel = 2, children }: CardProps) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading id={titleId} className="m-0 text-[17px] font-bold">
          {title}
        </Heading>
        {actions}
      </div>
      {children}
    </section>
  );
}
