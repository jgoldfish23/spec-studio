import { useId } from "react";
import { SegmentedControl } from "../../ui/SegmentedControl";
import type { SegmentedControlProps } from "../../ui/SegmentedControl";

/** A `SegmentedControl` with the engine's message for it under the group, tied to the group for assistive tech. */
export function SegmentedField<T extends string>({
  error,
  ...control
}: SegmentedControlProps<T> & { error?: string | undefined }) {
  const messageId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <SegmentedControl {...control} describedBy={error ? messageId : undefined} />
      {error ? (
        <p id={messageId} className="m-0 text-[13px] font-medium text-no-go">
          {error}
        </p>
      ) : null}
    </div>
  );
}
