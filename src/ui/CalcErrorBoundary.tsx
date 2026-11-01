import { Component, useMemo } from "react";
import type { ReactNode } from "react";
import { inputHash } from "../lib/inputHash";

interface BoundaryProps {
  hash: string;
  resetOn?: unknown;
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
    // A screen that was already failing gets another try once what it draws is different. A failure that arrives with
    // the change is not retried, or a change that always fails would loop.
    const changed = prevProps.hash !== this.props.hash || !Object.is(prevProps.resetOn, this.props.resetOn);
    if (prevState.error !== null && this.state.error !== null && changed) {
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
  /**
   * Something else the screen draws, whose change should also try it again (compared with `Object.is`). A result that
   * is worked out after the input changes (the deal's evaluation, up to 150 ms behind) belongs here: the input has
   * already changed by the time the screen is handed the result of the change, so a retry on the input alone would
   * fail against the old result and never try the new one.
   */
  resetOn?: unknown;
  children: ReactNode;
}

/**
 * Catches an exception thrown while drawing a screen that depends on the engine (spec §8), so the app around it keeps
 * working and nothing stored is changed. It says "Couldn't calculate", with the message and a hash of the input.
 */
export function CalcErrorBoundary({ input, resetOn, children }: CalcErrorBoundaryProps) {
  const hash = useMemo(() => inputHash(input), [input]);
  return (
    <Boundary hash={hash} resetOn={resetOn}>
      {children}
    </Boundary>
  );
}
