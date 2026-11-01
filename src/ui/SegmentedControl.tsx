export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The id of text that describes the group, such as an error message under it. */
  describedBy?: string;
}

/** A row of toggle buttons for choosing one of a few options. Selecting is by `aria-pressed`, not by color alone. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, describedBy }: SegmentedControlProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* The group carries the accessible name; this is the same text for sighted users. */}
      <span aria-hidden="true" className="text-[13px] font-semibold text-[#33403A]">
        {label}
      </span>
      <div role="group" aria-label={label} aria-describedby={describedBy} className="flex overflow-hidden rounded-lg border border-[#C9CEC8]">
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={option.disabled}
              onClick={() => {
                if (!selected) onChange(option.value);
              }}
              className={`min-h-11 flex-1 cursor-pointer px-3 text-sm focus-visible:-outline-offset-4 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                index > 0 ? "border-l border-[#C9CEC8]" : ""
              } ${
                selected
                  ? "bg-spruce font-semibold text-white focus-visible:outline-white"
                  : "bg-surface text-[#33403A] hover:bg-paper focus-visible:outline-spruce"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
