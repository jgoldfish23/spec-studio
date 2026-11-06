import { useId, useState, type ReactNode } from "react";
import type { Cents, ISODate, YearMonth } from "@engine";
import {
  formatMoney,
  formatMoneyInput,
  formatNumberInput,
  formatPercentCompact,
  formatPercentInput,
  parseDollars,
  parseNumber,
  parsePercent,
} from "../lib/format";

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces

/** Props every field takes. `error` comes from outside (the engine's validation); the field adds its own as well. */
interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
}

interface ControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

/** A label above a control, with the hint and the message under it, wired together for assistive tech. */
function FieldFrame({
  label,
  hint,
  message,
  children,
}: {
  label: string;
  hint?: string;
  message: string | null | undefined;
  children: (control: ControlProps, invalid: boolean) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const messageId = `${id}-message`;
  const describedBy = [hint ? hintId : null, message ? messageId : null].filter(Boolean).join(" ");
  const invalid = Boolean(message);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-[#33403A]">
        {label}
      </label>
      {children(
        { id, "aria-describedby": describedBy || undefined, "aria-invalid": invalid ? true : undefined },
        invalid,
      )}
      {hint ? (
        <p id={hintId} className="m-0 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={messageId} className="m-0 text-[13px] font-medium text-no-go">
          {message}
        </p>
      ) : null}
    </div>
  );
}

// 16 px below the `sm` breakpoint: iOS zooms the page into any box whose text is smaller than that.
const INPUT_CLASS =
  "min-w-0 flex-1 border-0 bg-transparent py-2.5 font-[inherit] text-base text-ink outline-hidden sm:text-[15px]";

/** The bordered box around an input, with an optional symbol or unit on either side. */
function InputBox({
  invalid,
  prefix,
  suffix,
  children,
}: {
  invalid: boolean;
  prefix?: string;
  suffix?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-h-11 items-center gap-1.5 rounded-lg border bg-surface px-3 text-base focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-spruce ${
        invalid ? "border-no-go inset-ring-1 inset-ring-no-go" : "border-[#C9CEC8]"
      } sm:text-[15px]`}
    >
      {prefix ? <span className="text-muted">{prefix}</span> : null}
      {children}
      {suffix ? <span className="text-muted">{suffix}</span> : null}
    </div>
  );
}

/** Wraps a parse result so that `undefined` can be a legitimate value (an emptied optional field). */
function found<T>(value: T | null): { value: T } | null {
  return value === null ? null : { value };
}

/** The message for a value outside min/max, or null when it is inside. `show` writes a bound in the field's units. */
function rangeMessage(
  value: number,
  min: number | undefined,
  max: number | undefined,
  show: (bound: number) => string,
): string | null {
  const tooLow = min !== undefined && value < min;
  const tooHigh = max !== undefined && value > max;
  if (!tooLow && !tooHigh) return null;
  if (min !== undefined && max !== undefined) return `Must be between ${show(min)} and ${show(max)}`;
  if (min !== undefined) return `Must be at least ${show(min)}`;
  return `Must be at most ${show(max ?? value)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The text-entry engine behind every typed field

interface ParsedInputProps<V> extends FieldProps {
  /** The value the rest of the app holds. */
  value: V;
  /** Called only with a value that parsed and passed `rangeMessage`. */
  onChange: (value: V) => void;
  /** `null` for text that is not a valid entry. The result is boxed so `undefined` can be a valid entry. */
  parse: (text: string) => { value: V } | null;
  format: (value: V) => string;
  invalidMessage: string;
  rangeMessage: (value: V) => string | null;
  prefix?: string;
  suffix?: string;
  type?: "text" | "month" | "date";
  /** Shown in an empty box; a browser that draws its own picker for `type` ignores it. */
  placeholder?: string;
}

/**
 * A controlled field that keeps the text as typed. The text is local state: `onChange` hears about it only once it
 * parses and is in range, so the app never holds a half-typed number. A value that changes from outside (undo, reset)
 * replaces the text unless the text already means that value.
 */
function ParsedInput<V>({
  label,
  hint,
  error,
  value,
  onChange,
  parse,
  format,
  invalidMessage,
  rangeMessage: checkRange,
  prefix,
  suffix,
  type = "text",
  placeholder,
}: ParsedInputProps<V>) {
  const [text, setText] = useState(() => format(value));
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [seenValue, setSeenValue] = useState(value);

  // Adjusting state while rendering (React's documented way to react to a prop change without an effect).
  if (!Object.is(seenValue, value)) {
    setSeenValue(value);
    const current = parse(text);
    if (current === null || !Object.is(current.value, value)) {
      setText(format(value));
      setInlineError(null);
    }
  }

  function handleChange(next: string) {
    setText(next);
    const parsed = parse(next);
    if (parsed === null) {
      setInlineError(invalidMessage);
      return;
    }
    const outOfRange = checkRange(parsed.value);
    setInlineError(outOfRange);
    if (outOfRange === null) onChange(parsed.value);
  }

  function handleBlur() {
    const parsed = parse(text);
    // Invalid text stays as it is, with its message.
    if (parsed === null || checkRange(parsed.value) !== null) return;
    // Tidy valid text, but only when the tidy text means exactly the value that was sent. If tidying would round it
    // (7.125 shown as 7.13), the box would show a number the deal does not hold, so the typed text stays.
    const tidy = format(parsed.value);
    const tidied = parse(tidy);
    if (tidied !== null && Object.is(tidied.value, parsed.value)) setText(tidy);
  }

  // What is in the box right now outranks what the engine said about the stored value.
  return (
    <FieldFrame label={label} hint={hint} message={inlineError ?? error}>
      {(control, invalid) => (
        <InputBox invalid={invalid} prefix={prefix} suffix={suffix}>
          <input
            {...control}
            type={type}
            inputMode={type === "text" ? "decimal" : undefined}
            placeholder={placeholder}
            value={text}
            onChange={(event) => handleChange(event.target.value)}
            onBlur={handleBlur}
            className={INPUT_CLASS}
          />
        </InputBox>
      )}
    </FieldFrame>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Money, percent, number

interface MoneyBounds {
  /** Whole dollars unless set: the field refuses cents. */
  allowCents?: boolean;
  min?: Cents;
  max?: Cents;
}

export interface MoneyFieldProps extends FieldProps, MoneyBounds {
  valueCents: Cents;
  onChange: (cents: Cents) => void;
}

/** A dollar amount, typed in dollars and stored as integer cents. */
export function MoneyField({ label, valueCents, onChange, allowCents = false, min, max, hint, error }: MoneyFieldProps) {
  return (
    <ParsedInput<Cents>
      label={label}
      hint={hint}
      error={error}
      value={valueCents}
      onChange={onChange}
      parse={(text) => found(parseDollars(text, { allowCents }))}
      format={(cents) => formatMoneyInput(cents, allowCents)}
      invalidMessage="Enter a dollar amount"
      rangeMessage={(cents) => rangeMessage(cents, min, max, (bound) => formatMoney(bound, { cents: allowCents }))}
      prefix="$"
    />
  );
}

export interface OptionalMoneyFieldProps extends FieldProps, MoneyBounds {
  valueCents: Cents | undefined;
  onChange: (cents: Cents | undefined) => void;
}

/** Like `MoneyField`, but an empty box is a valid answer: it means "no amount" and calls `onChange(undefined)`. */
export function OptionalMoneyField({
  label,
  valueCents,
  onChange,
  allowCents = false,
  min,
  max,
  hint,
  error,
}: OptionalMoneyFieldProps) {
  return (
    <ParsedInput<Cents | undefined>
      label={label}
      hint={hint}
      error={error}
      value={valueCents}
      onChange={onChange}
      parse={(text) => (text.trim() === "" ? { value: undefined } : found(parseDollars(text, { allowCents })))}
      format={(cents) => (cents === undefined ? "" : formatMoneyInput(cents, allowCents))}
      invalidMessage="Enter a dollar amount"
      rangeMessage={(cents) =>
        cents === undefined ? null : rangeMessage(cents, min, max, (bound) => formatMoney(bound, { cents: allowCents }))
      }
      prefix="$"
    />
  );
}

export interface PercentFieldProps extends FieldProps {
  /** A decimal: `0.09` is 9%. */
  value: number;
  onChange: (decimal: number) => void;
  /** Digits after the point when the box is tidied. Defaults to 2 (`9.00`). */
  digits?: number;
  min?: number;
  max?: number;
}

/** A percentage, typed as `9` or `9.5%` and stored as a decimal. */
export function PercentField({ label, value, onChange, digits = 2, min, max, hint, error }: PercentFieldProps) {
  return (
    <ParsedInput<number>
      label={label}
      hint={hint}
      error={error}
      value={value}
      onChange={onChange}
      parse={(text) => found(parsePercent(text))}
      format={(decimal) => formatPercentInput(decimal, digits)}
      invalidMessage="Enter a percent"
      rangeMessage={(decimal) => rangeMessage(decimal, min, max, (bound) => formatPercentCompact(bound, digits))}
      suffix="%"
    />
  );
}

export interface NumberFieldProps extends FieldProps {
  value: number;
  onChange: (n: number) => void;
  /** Shown beside the box and in range messages, e.g. `sf`. */
  unit?: string;
  /** Refuses a fraction. */
  integer?: boolean;
  min?: number;
  max?: number;
}

/** A plain number such as an area or a count. */
export function NumberField({ label, value, onChange, unit, integer = false, min, max, hint, error }: NumberFieldProps) {
  const show = (bound: number) => (unit ? `${formatNumberInput(bound)} ${unit}` : formatNumberInput(bound));
  return (
    <ParsedInput<number>
      label={label}
      hint={hint}
      error={error}
      value={value}
      onChange={onChange}
      parse={(text) => found(parseNumber(text, { integer }))}
      format={formatNumberInput}
      invalidMessage="Enter a number"
      rangeMessage={(n) => rangeMessage(n, min, max, show)}
      suffix={unit}
    />
  );
}

export interface OptionalNumberFieldProps extends FieldProps {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  /** Shown beside the box and in range messages, e.g. `ft`. */
  unit?: string;
  /** Refuses a fraction. */
  integer?: boolean;
  min?: number;
  max?: number;
}

/** Like `NumberField`, but an empty box is a valid answer: it means "no value" and calls `onChange(undefined)`. */
export function OptionalNumberField({
  label,
  value,
  onChange,
  unit,
  integer = false,
  min,
  max,
  hint,
  error,
}: OptionalNumberFieldProps) {
  const show = (bound: number) => (unit ? `${formatNumberInput(bound)} ${unit}` : formatNumberInput(bound));
  return (
    <ParsedInput<number | undefined>
      label={label}
      hint={hint}
      error={error}
      value={value}
      onChange={onChange}
      parse={(text) => (text.trim() === "" ? { value: undefined } : found(parseNumber(text, { integer })))}
      format={(n) => (n === undefined ? "" : formatNumberInput(n))}
      invalidMessage="Enter a number"
      rangeMessage={(n) => (n === undefined ? null : rangeMessage(n, min, max, show))}
      suffix={unit}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Month and date: native pickers

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface MonthFieldProps extends FieldProps {
  value: YearMonth;
  onChange: (month: YearMonth) => void;
}

/**
 * A month, with the browser's own month picker. A browser without one shows a plain box, with "YYYY-MM" in it until
 * something is typed. `onChange` hears only a well-formed `YYYY-MM`.
 */
export function MonthField({ label, value, onChange, hint, error }: MonthFieldProps) {
  return (
    <ParsedInput<YearMonth>
      label={label}
      hint={hint}
      error={error}
      value={value}
      onChange={onChange}
      parse={(text) => (MONTH.test(text) ? { value: text } : null)}
      format={(month) => month}
      invalidMessage="Enter a month"
      rangeMessage={() => null}
      type="month"
      placeholder="YYYY-MM"
    />
  );
}

export interface DateFieldProps extends FieldProps {
  value: ISODate;
  onChange: (date: ISODate) => void;
}

/** A calendar date, with the browser's own date picker. `onChange` hears only a well-formed `YYYY-MM-DD`. */
export function DateField({ label, value, onChange, hint, error }: DateFieldProps) {
  return (
    <ParsedInput<ISODate>
      label={label}
      hint={hint}
      error={error}
      value={value}
      onChange={onChange}
      parse={(text) => (DATE.test(text) ? { value: text } : null)}
      format={(date) => date}
      invalidMessage="Enter a date"
      rangeMessage={() => null}
      type="date"
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Text and toggle

export interface TextFieldProps extends FieldProps {
  value: string;
  onChange: (text: string) => void;
  onBlur?: () => void;
  /** `date` draws the browser's own date picker; the value is then `YYYY-MM-DD` or empty. */
  type?: "text" | "date" | "email";
  /** The keyboard a phone offers. */
  inputMode?: "text" | "decimal" | "numeric" | "email";
  /** A symbol before the text, e.g. `$`. */
  prefix?: string;
}

/** Plain text. Fully controlled: there is nothing to parse, so the box holds exactly what was typed. */
export function TextField({ label, value, onChange, onBlur, hint, error, type = "text", inputMode, prefix }: TextFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} message={error}>
      {(control, invalid) => (
        <InputBox invalid={invalid} prefix={prefix}>
          <input
            {...control}
            type={type}
            inputMode={inputMode}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            className={INPUT_CLASS}
          />
        </InputBox>
      )}
    </FieldFrame>
  );
}

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** A labelled checkbox. The whole row is the click target. */
export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 accent-spruce"
      />
      {label}
    </label>
  );
}
