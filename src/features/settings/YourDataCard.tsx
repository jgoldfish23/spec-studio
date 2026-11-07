import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_MARKET_SETTINGS } from "@engine";
import {
  buildExport,
  deviceCopyNote,
  unreadableNote,
  downloadExport,
  MAX_EXPORT_CHARS,
  parseExport,
  planImport,
  runImport,
} from "../../data/exportFile";
import type { ExportFile, ImportReport } from "../../data/exportFile";
import type { Comp } from "@engine";
import type { StoredDeal } from "../../data/types";
import { queryKeys, useRepository } from "../../data/queries";
import { errorMessage } from "../../lib/errorMessage";
import { Card } from "../../ui/Card";
import { SECONDARY_BUTTON } from "../deal/stepShared";
import { ImportPreview } from "./ImportPreview";

const REGION = DEFAULT_MARKET_SETTINGS.region;
const TOO_BIG = "That file is too big to be a Spec Studio export.";
const INPUT =
  "min-h-11 rounded-lg border border-[#C9CEC8] bg-surface px-3 text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";

/** A file's text. `File.text()` where the browser has it, a reader where it does not. */
function readFile(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The file couldn't be read."));
    reader.readAsText(file);
  });
}

/** Export everything to a file or the clipboard, and bring an export back in. The same in demo and hosted mode. */
export function YourDataCard() {
  const repository = useRepository();
  const queryClient = useQueryClient();
  const pasteId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    problem: boolean;
  } | null>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const [pasted, setPasted] = useState("");
  const [loaded, setLoaded] = useState<{
    file: ExportFile;
    deals: StoredDeal[];
    comps: Comp[];
  } | null>(null);
  const [replaceSettings, setReplaceSettings] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fallbackText !== null) fallbackRef.current?.select();
  }, [fallbackText]);

  const plan = useMemo(
    () => (loaded ? planImport(loaded.file, { deals: loaded.deals, comps: loaded.comps }, { replaceSettings }) : null),
    [loaded, replaceSettings],
  );

  async function exportAll() {
    setBusy(true);
    setMessage(null);
    try {
      const now = new Date().toISOString();
      const { file, unreadable, notice } = await buildExport(repository, REGION, now);
      const name = downloadExport(file, now);
      // A partial export, or one that may be missing changes made elsewhere, is said out loud.
      setMessage({
        text: `Downloaded ${name}.${unreadableNote(unreadable)}${deviceCopyNote(notice)}`,
        problem: unreadable !== 0 || notice !== undefined,
      });
    } catch (error) {
      setMessage({
        text: `Couldn't export your data: ${errorMessage(error)}`,
        problem: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyAll() {
    setBusy(true);
    setMessage(null);
    setFallbackText(null);
    try {
      const { file, unreadable, notice } = await buildExport(repository, REGION, new Date().toISOString());
      const text = JSON.stringify(file, null, 2);
      const lost = `${unreadableNote(unreadable)}${deviceCopyNote(notice)}`;
      const partial = unreadable !== 0 || notice !== undefined;
      try {
        await navigator.clipboard.writeText(text);
        setMessage({
          text: `Copied your data to the clipboard.${lost}`,
          problem: partial,
        });
      } catch {
        setMessage({
          text: `Couldn't copy automatically. Select the text below and copy it.${lost}`,
          problem: partial,
        });
        setFallbackText(text);
      }
    } catch (error) {
      setMessage({
        text: `Couldn't export your data: ${errorMessage(error)}`,
        problem: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function preview(text: string) {
    setReport(null);
    setLoaded(null);
    setReplaceSettings(false);
    const parsed = parseExport(text);
    if (!parsed.ok) {
      setMessage({ text: parsed.message, problem: true });
      return;
    }
    setBusy(true);
    try {
      const [list, comps] = await Promise.all([repository.listDeals(), repository.listComps(REGION)]);
      setMessage(null);
      setLoaded({ file: parsed.file, deals: list.deals, comps });
    } catch (error) {
      setMessage({
        text: `Couldn't check what you already have: ${errorMessage(error)}`,
        problem: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_EXPORT_CHARS) {
      setLoaded(null);
      setReport(null);
      setMessage({ text: TOO_BIG, problem: true });
      return;
    }
    try {
      await preview(await readFile(file));
    } catch (error) {
      setMessage({
        text: `Couldn't read that file: ${errorMessage(error)}`,
        problem: true,
      });
    }
  }

  function cancelImport() {
    setLoaded(null);
    setReplaceSettings(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function doImport() {
    if (!plan) return;
    setRunning(true);
    setMessage(null);
    try {
      const result = await runImport(repository, plan);
      setReport(result);
      // Whatever got in is shown, even when the import stopped part-way.
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.deals }),
          queryClient.invalidateQueries({ queryKey: queryKeys.allComps }),
          queryClient.invalidateQueries({ queryKey: queryKeys.companySettings }),
          queryClient.invalidateQueries({ queryKey: queryKeys.marketSettings(REGION) }),
        ]);
      } catch (error) {
        setReport({
          ...result,
          failed: true,
          message: `${result.message} The screens couldn't refresh (${errorMessage(error)}). Reload the page to see what was imported.`,
        });
      }
      setLoaded(null);
      setPasted("");
      setReplaceSettings(false);
      if (fileInput.current) fileInput.current.value = "";
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card title="Your data">
      <p className="m-0 text-sm text-muted">
        Export your deals, comps and settings to a file, or bring an export in. This is how demo deals move into your
        account.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void exportAll()}
          disabled={busy || running}
          className={`${SECONDARY_BUTTON} disabled:opacity-60`}
        >
          Export all data
        </button>
        <button
          type="button"
          onClick={() => void copyAll()}
          disabled={busy || running}
          className={`${SECONDARY_BUTTON} disabled:opacity-60`}
        >
          Copy to clipboard
        </button>
      </div>

      {fallbackText !== null ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${pasteId}-copy`} className="text-sm font-medium">
            Your data, ready to copy
          </label>
          <textarea
            id={`${pasteId}-copy`}
            ref={fallbackRef}
            readOnly
            value={fallbackText}
            rows={6}
            onFocus={(event) => event.currentTarget.select()}
            className={`${INPUT} py-2 font-mono text-xs`}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="m-0 text-[15px] font-bold">Import an export</h3>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${pasteId}-file`} className="text-sm font-medium">
            Choose an export file
          </label>
          <input
            id={`${pasteId}-file`}
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(event) => void chooseFile(event.target.files?.[0])}
            className="min-h-11 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${pasteId}-paste`} className="text-sm font-medium">
            Or paste an export
          </label>
          <textarea
            id={`${pasteId}-paste`}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={4}
            className={`${INPUT} py-2 font-mono text-xs`}
          />
          <div>
            <button
              type="button"
              onClick={() => void preview(pasted)}
              disabled={busy || running || pasted.trim() === ""}
              className={`${SECONDARY_BUTTON} disabled:opacity-60`}
            >
              Preview import
            </button>
          </div>
        </div>
      </div>

      {plan ? (
        <ImportPreview
          plan={plan}
          replaceSettings={replaceSettings}
          onReplaceSettingsChange={setReplaceSettings}
          running={running}
          onImport={() => void doImport()}
          onCancel={cancelImport}
        />
      ) : null}

      {message ? (
        <p
          role={message.problem ? "alert" : "status"}
          className={`m-0 text-sm font-medium ${message.problem ? "text-no-go" : "text-ink"}`}
        >
          {message.text}
        </p>
      ) : null}
      {report ? (
        <p
          role={report.failed ? "alert" : "status"}
          className={`m-0 text-sm font-medium ${report.failed ? "text-no-go" : "text-ink"}`}
        >
          {report.message}
        </p>
      ) : null}
    </Card>
  );
}
