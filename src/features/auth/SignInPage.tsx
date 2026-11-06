import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { authErrorFrom } from "../../data/auth/authGateway";
import type { AuthError, AuthGateway } from "../../data/auth/authGateway";
import { TextField } from "../../ui/fields";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../deal/stepShared";
import { AuthFrame, Problem } from "./AuthFrame";
import { redirectUrl } from "./linkCallback";

export interface SignInPageProps {
  auth: AuthGateway;
  /** Why the link the owner followed did not sign them in. */
  callbackError?: AuthError;
}

type Stage = "enterEmail" | "codeSent";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_SHAPE = /^\d{6}$/;
const BUTTON = "disabled:cursor-default disabled:opacity-60";

/**
 * Sign in by emailed link or 6-digit code. A link opened in another browser cannot finish, so that failure opens
 * straight on the code entry (with the email box shown, as the email is not known here).
 */
export function SignInPage({ auth, callbackError }: SignInPageProps) {
  const otherBrowser = callbackError?.reason === "otherBrowser";
  const [stage, setStage] = useState<Stage>(
    otherBrowser ? "codeSent" : "enterEmail",
  );
  const [email, setEmail] = useState("");
  const [emailKnown, setEmailKnown] = useState(!otherBrowser);
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [codeError, setCodeError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(
    callbackError?.message ?? null,
  );
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  // Each new state starts with the cursor in its first field.
  useEffect(() => {
    form.current?.querySelector("input")?.focus();
  }, [stage]);

  /** Runs one request; a second click while it is out does nothing. */
  async function run(request: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await request();
    } catch (error) {
      setProblem(authErrorFrom(error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function validEmail(): boolean {
    const ok = EMAIL_SHAPE.test(email.trim());
    setEmailError(ok ? undefined : "Enter an email address");
    return ok;
  }

  function sendLink(event: FormEvent) {
    event.preventDefault();
    if (!validEmail()) return;
    void run(async () => {
      await auth.sendSignInEmail(email.trim(), redirectUrl(window.location));
      setEmailKnown(true);
      setCode("");
      setStage("codeSent");
    });
  }

  function signIn(event: FormEvent) {
    event.preventDefault();
    const emailOk = emailKnown || validEmail();
    const codeOk = CODE_SHAPE.test(code.trim());
    setCodeError(codeOk ? undefined : "Enter the 6-digit code");
    if (!emailOk || !codeOk) return;
    void run(async () => {
      await auth.verifyCode(email.trim(), code.trim());
    });
  }

  function useDifferentEmail() {
    setProblem(null);
    setCodeError(undefined);
    setEmailError(undefined);
    setEmailKnown(true);
    setStage("enterEmail");
  }

  if (stage === "enterEmail") {
    return (
      <AuthFrame title="Sign in to Spec Studio">
        <form
          ref={form}
          onSubmit={sendLink}
          noValidate
          className="flex flex-col gap-4"
        >
          <TextField
            label="Email"
            type="email"
            inputMode="email"
            value={email}
            onChange={setEmail}
            error={emailError}
          />
          <button
            type="submit"
            disabled={busy}
            className={`${PRIMARY_BUTTON} ${BUTTON}`}
          >
            Email me a sign-in link
          </button>
          <Problem message={problem} />
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Check your email">
      {emailKnown ? (
        <p className="m-0 mb-4 text-[15px] wrap-break-word">
          We sent a link and a 6-digit code to {email.trim()}.
        </p>
      ) : (
        <p className="m-0 mb-4 text-[15px]">
          Enter your email and the 6-digit code from the email we sent.
        </p>
      )}
      <form
        ref={form}
        onSubmit={signIn}
        noValidate
        className="flex flex-col gap-4"
      >
        {emailKnown ? null : (
          <TextField
            label="Email"
            type="email"
            inputMode="email"
            value={email}
            onChange={setEmail}
            error={emailError}
          />
        )}
        <TextField
          label="6-digit code"
          inputMode="numeric"
          value={code}
          onChange={setCode}
          error={codeError}
        />
        <button
          type="submit"
          disabled={busy}
          className={`${PRIMARY_BUTTON} ${BUTTON}`}
        >
          Sign in
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={useDifferentEmail}
          className={`${SECONDARY_BUTTON} ${BUTTON}`}
        >
          Use a different email
        </button>
        <Problem message={problem} />
      </form>
    </AuthFrame>
  );
}
