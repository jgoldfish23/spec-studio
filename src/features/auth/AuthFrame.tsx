import type { ReactNode } from "react";

/** The full-page frame of the sign-in and company-setup screens: the wordmark over one centered card. */
export function AuthFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center gap-6 bg-paper px-4 py-10 text-ink">
      <p className="m-0 text-[22px] font-bold tracking-[-0.01em] text-spruce-dark">
        Spec Studio
      </p>
      <main className="w-full max-w-[420px] min-w-0 rounded-xl border border-line bg-surface p-5 sm:p-6">
        <h1 className="m-0 mb-4 text-xl font-bold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

/** Where a problem with the last request is read out as it appears. Always in the page, so the reader hears it change. */
export function Problem({ message }: { message: string | null }) {
  return (
    <div aria-live="polite" className="min-h-0 wrap-break-word">
      {message ? (
        <p className="m-0 mt-3 text-[13px] font-medium text-no-go">{message}</p>
      ) : null}
    </div>
  );
}

/** Why the page opened as it did (a sign-in link that failed). Above the fields, and announced although it is there from the start. */
export function Notice({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="m-0 mb-4 text-[13px] font-medium text-no-go wrap-break-word"
    >
      {message}
    </p>
  ) : null;
}
