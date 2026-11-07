import { useState } from "react";
import { useBlocker } from "react-router";
import { DEFAULT_MARKET_SETTINGS } from "@engine";
import { useCompanySettings, useMarketSettings } from "../../data/queries";
import { errorMessage } from "../../lib/errorMessage";
import { SECONDARY_BUTTON } from "../deal/stepShared";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { MarketSection } from "./MarketSection";
import { QuantityRulesSection } from "./QuantityRulesSection";
import { RulesSection } from "./RulesSection";

/** The one region the app knows: Northern Utah (Davis & Weber). */
const REGION = DEFAULT_MARKET_SETTINGS.region;

/** A read that failed: what happened, and a way to try again. */
function LoadFailed({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="m-0 text-sm font-medium text-no-go">
        {text}
      </p>
      <button type="button" onClick={onRetry} className={SECONDARY_BUTTON}>
        Try again
      </button>
    </div>
  );
}

const NOTE = "m-0 text-sm text-muted";

/**
 * Settings: the rules and contingency new deals start from, the market's numbers, and the takeoff's rules. Leaving
 * with edits that were not saved asks first.
 */
export function SettingsPage() {
  const company = useCompanySettings();
  const market = useMarketSettings(REGION);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [marketDirty, setMarketDirty] = useState(false);
  const blocker = useBlocker(rulesDirty || marketDirty);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[30px] font-bold tracking-[-0.02em]">Settings</h1>
        <p className="m-0 text-[15px] text-muted">How your deals are judged and how the market is read.</p>
      </div>

      {company.data ? (
        <RulesSection saved={company.data} onDirtyChange={setRulesDirty} />
      ) : company.isError ? (
        <LoadFailed text={`Couldn't load your rules: ${errorMessage(company.error)}`} onRetry={() => void company.refetch()} />
      ) : (
        <p role="status" className={NOTE}>
          Loading your rules…
        </p>
      )}

      {market.data ? (
        <MarketSection saved={market.data} onDirtyChange={setMarketDirty} />
      ) : market.isError ? (
        <LoadFailed text={`Couldn't load the market settings: ${errorMessage(market.error)}`} onRetry={() => void market.refetch()} />
      ) : (
        <p role="status" className={NOTE}>
          Loading the market settings…
        </p>
      )}

      <QuantityRulesSection />

      {blocker.state === "blocked" ? (
        <ConfirmDialog
          message="You have unsaved settings. Leave without saving?"
          confirmLabel="Leave"
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      ) : null}
    </div>
  );
}
