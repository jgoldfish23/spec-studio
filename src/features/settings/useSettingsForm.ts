import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { errorMessage } from "../../lib/errorMessage";

/** A problem with one field of a settings form: a dotted path such as `rules.minMarginOnSale`, and the schema's message. */
export interface SettingsIssue {
  path: string;
  message: string;
}

/** The message for the field at exactly `path`, or undefined. */
export function issueAt(issues: readonly SettingsIssue[], path: string): string | undefined {
  return issues.find((issue) => issue.path === path)?.message;
}

/** Turns a failed Zod parse into issues with dotted paths. */
export function issuesOf(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): SettingsIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export interface SettingsFormOptions<T> {
  /** What is stored now. */
  saved: T;
  /** The problems with a draft; none means it can be saved. */
  validate: (draft: T) => SettingsIssue[];
  /** Stores the draft, and gives back what was stored. */
  save: (draft: T) => Promise<T>;
  /** Told whenever the form gains or loses unsaved edits. */
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * A settings form's draft, and the one save behind it. The draft is what the owner has typed; `dirty` is whether it
 * differs from what was last stored; a successful save makes the draft the stored copy, so the form is clean again.
 * Editing after a save clears the "Saved" line. A failed save keeps the draft and says why.
 */
export function useSettingsForm<T>({ saved, validate, save, onDirtyChange }: SettingsFormOptions<T>) {
  const [draft, setDraftState] = useState<T>(saved);
  const [baseline, setBaseline] = useState<T>(saved);
  const [justSaved, setJustSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const issues = validate(draft);

  const told = useRef(onDirtyChange);
  useEffect(() => {
    told.current = onDirtyChange;
  });
  useEffect(() => {
    told.current(dirty);
  }, [dirty]);
  // Leaving the screen means nothing is pending any more.
  useEffect(() => () => told.current(false), []);

  function change(update: (draft: T) => T) {
    setDraftState(update);
    setJustSaved(false);
    setFailure(null);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (saving || issues.length > 0) return;
    setSaving(true);
    setFailure(null);
    try {
      const stored = await save(draft);
      setBaseline(stored);
      setDraftState(stored);
      setJustSaved(true);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return { draft, change, dirty, issues, saving, justSaved, failure, submit };
}
