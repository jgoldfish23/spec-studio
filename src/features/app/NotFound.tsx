import { Link } from "react-router";

export function NotFound() {
  return (
    <section className="flex flex-col items-start gap-3">
      <h1 className="text-[30px] font-bold tracking-[-0.02em]">Page not found</h1>
      <p className="text-muted">That address doesn't match anything in Spec Studio.</p>
      <Link
        to="/deals"
        className="inline-flex min-h-11 items-center rounded-lg bg-spruce px-4.5 font-semibold text-white hover:bg-spruce-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce"
      >
        Back to Deals
      </Link>
    </section>
  );
}
