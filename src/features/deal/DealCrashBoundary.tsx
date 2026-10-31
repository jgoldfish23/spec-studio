import { Component } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { FOCUS_RING } from "./stepShared";

interface State {
  error: Error | null;
}

/**
 * The last line of defence around a deal's screen: catches an exception thrown while drawing it that no step's own
 * boundary caught (a bug in the frame itself). An exception in the engine never gets here, because the editor catches
 * it and the frame shows "Couldn't calculate" instead. What was saved stays saved, and the way on is back to the list.
 */
export class DealCrashBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-[#F2C2BE] bg-no-go-bg p-4 text-no-go">
        <p className="m-0 text-[17px] font-bold">Something went wrong showing this deal.</p>
        <p className="m-0 text-sm">Your last saved changes are kept. Go back to Deals and open it again.</p>
        <details className="text-sm">
          <summary className="cursor-pointer py-2.5 font-semibold">Details</summary>
          <p className="m-0 break-words">{error.message}</p>
        </details>
        <Link
          to="/deals"
          className={`inline-flex min-h-11 items-center rounded-lg bg-spruce px-4.5 font-semibold text-white no-underline hover:bg-spruce-dark ${FOCUS_RING}`}
        >
          Back to Deals
        </Link>
      </div>
    );
  }
}
