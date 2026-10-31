/** Stands in for a step's screen while its code is being fetched; shaped like the deal frame's own loading skeleton. */
export function StepSkeleton() {
  return (
    <div role="status" aria-label="Loading step" className="flex animate-pulse flex-col gap-4">
      <div className="h-24 rounded-xl bg-line" />
      <div className="h-64 rounded-xl bg-line" />
    </div>
  );
}
