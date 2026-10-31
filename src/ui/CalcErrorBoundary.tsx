import { Component, useMemo } from "react";
import type { ReactNode } from "react";
import { inputHash } from "../lib/inputHash";

interface BoundaryProps {
  hash: string;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(prevProps: BoundaryProps, prevState: BoundaryState) {
    // A screen that was already failing gets another try once the input is different. A failure that arrives with
    // the change is not retried, or a change that always fails would loop.
    if (prevState.error !== null && this.state.error !== null && prevProps.hash !== this.props.hash) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-xl border border-[#F2C2BE] bg-no-go-bg p-4 text-no-go">
        <p className="m-0 text-[17px] font-bold">Couldn't calculate</p>
        <p className="m-0 text-sm">Your saved deal is unaffected. Change an input and it will try again.</p>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Details</summary>
          <p className="m-0 mt-2 break-words">{error.message}</p>
          <p className="m-0 mt-1">Input hash: {this.props.hash}</p>
        </details>
      </div>
    );
  }
}

export interface CalcErrorBoundaryProps {
  /** What the screen calculates from. Its hash is shown with the error, and a new hash tries the screen again. */
  input: unknown;
  children: ReactNode;
}

/**
 * Catches an exception thrown while drawing a screen that depends on the engine (spec §8), so the app around it keeps
 * working and nothing stored is changed. It says "Couldn't calculate", with the message and a hash of the input.
 */
export function CalcErrorBoundary({ input, children }: CalcErrorBoundaryProps) {
  const hash = useMemo(() => inputHash(input), [input]);
  return <Boundary hash={hash}>{children}</Boundary>;
}
