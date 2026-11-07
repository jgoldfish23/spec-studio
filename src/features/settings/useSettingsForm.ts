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

/** A validator for a draft, from a Zod schema: the schema's issues, with dotted paths. */
export function schemaValidator<T>(schema: {
  safeParse: (value: T) => { success: true } | { success: false; error: Parameters<typeof issuesOf>[0] };
}): (draft: T) => SettingsIssue[] {
  return (draft) => {
    const parsed = schema.safeParse(draft);
    return parsed.success ? [] : issuesOf(parsed.error);
  };
}

export interface SettingsFormOptions<T> {
  /** What is stored now. */
  saved: T;
  /** The problems with a draft; none means it can be saved. */
  validate: (draft: T) => SettingsIssue[];
  /** Stores the draft. */
  save: (draft: T) => Promise<unknown>;
  /** Told whenever the form gains or loses unsaved edits. */
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * A settings form's draft, and the one save behind it. The draft is what the owner has typed; `dirty` is whether it
 * differs from what was last stored, or a box holds text that is not a value; a successful save makes the copy that
 * was sent the stored one. Edits made while a save is on its way stay in the draft: the form is then still dirty and
 * does not say "Saved". A failed save keeps the draft and says why.
 */
export function useSettingsForm<T>({ saved, validate, save, onDirtyChange }: SettingsFormOptions<T>) {
  const [draft, setDraft] = useState<T>(saved);
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(saved));
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [invalidBoxes, setInvalidBoxes] = useState<ReadonlySet<string>>(new Set());

  const draftJson = JSON.stringify(draft);
  const dirty = draftJson !== baseline || invalidBoxes.size > 0;
  const issues = validate(draft);
  const canSave = issues.length === 0 && invalidBoxes.size === 0;
  const justSaved = savedJson !== null && savedJson === draftJson && invalidBoxes.size === 0;

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
    setDraft(update);
    setFailure(null);
  }

  /** For a box's `onInvalidChange`: whether the box named `key` holds text that is not a value. */
  const invalid = (key: string) => (isInvalid: boolean) =>
    setInvalidBoxes((current) => {
      if (current.has(key) === isInvalid) return current;
      const next = new Set(current);
      if (isInvalid) next.add(key);
      else next.delete(key);
      return next;
    });

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (saving || !canSave) return;
    setSaving(true);
    setFailure(null);
    const sent = draftJson;
    try {
      await save(draft);
      setBaseline(sent);
      setSavedJson(sent);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return { draft, change, dirty, issues, canSave, invalid, saving, justSaved, failure, submit };
}
