import { useContext } from "react";
import type { ReactNode } from "react";
import { Link, Outlet, useMatches } from "react-router";
import { withoutSavePrefix } from "../../lib/errorMessage";
import { dismissLostSave, useLostSaves } from "../deal/lostSaves";
import type { LostSave } from "../deal/lostSaves";
import { PersistentStorageContext } from "./storageMode";

/** Sections that arrive in later phases: shown so the product's shape is visible, but inert. */
const LATER_SECTIONS = ["Cost book", "Comps", "Plans", "Builds"] as const;

/**
 * Marks the routes that belong to the Deals section: the list and every step of a deal, but not an address that
 * merely starts like them. The shell reads it from the matched routes, so a path that matches nothing is never marked.
 */
export const DEALS_SECTION = { section: "deals" } as const;

const isDealsSection = (handle: unknown): boolean =>
  typeof handle === "object" && handle !== null && "section" in handle && handle.section === DEALS_SECTION.section;

/** The banner's sentence. The reason often starts "Couldn't save — " already, which the sentence says. */
function lostSaveText({ dealName, message }: LostSave): string {
  const reason = withoutSavePrefix(message);
  return `Couldn't save your last changes to ${dealName}${reason ? `: ${reason}` : "."}`;
}

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay";

function HouseLogo() {
  return (
    <svg
      aria-hidden="true"
      width="26"
      height="26"
      viewBox="0 0 26 26"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-clay"
    >
      <path d="M3 12 13 4l10 8" />
      <path d="M6 10v12h14V10" />
      <path d="M11 22v-6h4v6" />
    </svg>
  );
}

/** A small rounded note on the dark header, with a clay dot: the demo pill, and its hosted-mode counterparts. */
const PILL = "m-0 flex items-center gap-2 rounded-full border border-nav-line px-3 py-1 text-xs text-nav-text";

function PillDot() {
  return <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-clay" />;
}

/**
 * Hosted mode: how many edits on this device have not reached the server. The region is always there and polite, so a
 * screen reader hears the count when it changes; it is empty while nothing waits.
 */
export function SyncNote({ count }: { count: number }) {
  return (
    <div role="status">
      {count > 0 ? (
        <p className={PILL}>
          <PillDot />
          {count === 1 ? "1 change waiting to sync" : `${count} changes waiting to sync`}
        </p>
      ) : null}
    </div>
  );
}

export interface AppShellProps {
  /** Hosted mode: the signed-in owner's account menu, in place of the demo pill. */
  account?: ReactNode;
  /** Hosted mode: what is waiting to sync (`SyncNote`), beside the account. */
  syncNote?: ReactNode;
}

export function AppShell({ account, syncNote }: AppShellProps) {
  const dealsActive = useMatches().some((match) => isDealsSection(match.handle));
  const lostSaves = useLostSaves();
  const persistent = useContext(PersistentStorageContext);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="bg-spruce-dark px-4 text-paper sm:px-8">
        <div className="mx-auto flex min-h-15 max-w-[1320px] flex-wrap items-center gap-x-4 gap-y-1 py-2">
          <Link
            to="/deals"
            className={`order-1 flex min-h-11 items-center gap-2.5 rounded-md text-[17px] font-bold tracking-[-0.01em] text-paper no-underline ${focusRing}`}
          >
            <HouseLogo />
            Spec Studio
          </Link>

          {/* On a phone the pill sits beside the brand and the nav wraps onto its own row. */}
          <nav aria-label="Main" className="order-3 w-full text-sm md:order-2 md:w-auto">
            <ul className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
              <li>
                <Link
                  to="/deals"
                  aria-current={dealsActive ? "page" : undefined}
                  className={`flex min-h-11 items-center rounded-md px-3 no-underline ${focusRing} ${
                    dealsActive ? "bg-nav-active font-semibold text-white" : "text-nav-text"
                  }`}
                >
                  Deals
                </Link>
              </li>
              {LATER_SECTIONS.map((name) => (
                <li key={name}>
                  <span
                    aria-disabled="true"
                    className="flex min-h-11 items-center gap-1.5 px-3 text-nav-off"
                  >
                    {name}
                    <span className="rounded-sm border border-nav-line px-1.5 py-px text-[11px]">
                      Later
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </nav>

          {account === undefined ? (
            <p className="order-2 ml-auto flex items-center gap-2 rounded-full border border-nav-line px-3 py-1 text-xs text-nav-text md:order-3">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-clay" />
              {persistent ? "Demo mode · saved in this browser" : "Demo mode · not saved — this browser blocks storage"}
            </p>
          ) : (
            <div className="order-2 ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 md:order-3">
              {syncNote}
              {persistent ? null : (
                <p className={PILL}>
                  <PillDot />
                  Not saved on this device — this browser blocks storage
                </p>
              )}
              {account}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8">
        {/* Edits that could not be saved and are gone: the owner must hear about them, wherever they are in the app. */}
        {lostSaves.length > 0 ? (
          <div className="mb-6 flex flex-col gap-2">
            {lostSaves.map((entry) => (
              <div
                key={entry.dealId}
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#F2C2BE] bg-no-go-bg px-4 py-2 text-sm font-medium text-no-go"
              >
                <p className="m-0 min-w-0 flex-1">{lostSaveText(entry)}</p>
                <button
                  type="button"
                  onClick={() => dismissLostSave(entry.dealId)}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-no-go px-3.5 font-semibold hover:bg-surface ${focusRing}`}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
