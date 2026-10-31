/** Stands in for a step's screen until it is built; each later task replaces one route's element with the real screen. */
export function StepPlaceholder({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-[30px] font-bold tracking-[-0.02em]">{title}</h1>
      <p className="m-0 text-muted">This step is being built.</p>
    </section>
  );
}
