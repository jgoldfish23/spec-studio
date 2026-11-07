import { PRIMARY_BUTTON } from "../deal/stepShared";

interface SaveBarProps {
  disabled: boolean;
  saving: boolean;
  saved: boolean;
  failure: string | null;
}

/** The foot of a settings form: Save changes, a polite "Saved" line, and the reason a save failed. */
export function SaveBar({ disabled, saving, saved, failure }: SaveBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={disabled || saving}
        className={`${PRIMARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        Save changes
      </button>
      <p role="status" className="m-0 text-sm font-semibold text-spruce">
        {saved ? "Saved" : ""}
      </p>
      {failure ? (
        <p role="alert" className="m-0 min-w-0 flex-1 text-sm font-medium text-no-go">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
