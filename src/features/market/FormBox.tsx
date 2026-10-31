import { useId } from "react";

export interface FormBoxProps {
  label: string;
  value: string;
  onChange: (text: string) => void;
  hint?: string;
  error?: string | undefined;
  /** `date` draws the browser's own date picker. */
  type?: "text" | "date";
  /** The keyboard a phone offers. */
  inputMode?: "text" | "decimal" | "numeric";
  prefix?: string;
}

/**
 * A text box whose value is the text as typed, with its label, hint and message wired together for assistive tech.
 * The comp form keeps every box as text and reads it all at Save, so unlike the UI kit's typed fields this one never
 * parses, holds back or rewrites what is in the box. It is drawn the same way as the kit's fields.
 */
export function FormBox({ label, value, onChange, hint, error, type = "text", inputMode, prefix }: FormBoxProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const messageId = `${id}-message`;
  const describedBy = [hint ? hintId : null, error ? messageId : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-[#33403A]">
        {label}
      </label>
      <div
        className={`flex min-h-11 items-center gap-1.5 rounded-lg border bg-surface px-3 text-[15px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-spruce ${
          error ? "border-no-go inset-ring-1 inset-ring-no-go" : "border-[#C9CEC8]"
        }`}
      >
        {prefix ? <span className="text-muted">{prefix}</span> : null}
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="min-w-0 flex-1 border-0 bg-transparent py-2.5 font-[inherit] text-[15px] text-ink outline-hidden"
        />
      </div>
      {hint ? (
        <p id={hintId} className="m-0 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={messageId} className="m-0 text-[13px] font-medium text-no-go">
          {error}
        </p>
      ) : null}
    </div>
  );
}
