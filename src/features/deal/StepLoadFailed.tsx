import { PRIMARY_BUTTON } from "./stepShared";

export interface StepLoadFailedProps {
  /** What Reload does; the page's own reload unless a test says otherwise. */
  onReload?: () => void;
}

/**
 * Stands in for a step's screen when its code could not be fetched (the network dropped, or the site was updated under
 * an open tab). Nothing about the deal is wrong, so it does not say "Couldn't calculate"; the way out is a reload.
 */
export function StepLoadFailed({ onReload = () => window.location.reload() }: StepLoadFailedProps) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-[#F2C2BE] bg-no-go-bg p-4 text-no-go">
      <p className="m-0 text-[17px] font-bold">Couldn't load this screen — reload the page</p>
      <p className="m-0 text-sm">Your saved deal is unaffected.</p>
      <button type="button" onClick={onReload} className={PRIMARY_BUTTON}>
        Reload
      </button>
    </div>
  );
}
