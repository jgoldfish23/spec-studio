import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AuthError } from "../../data/auth/authGateway";
import { FAKE_CODE, createFakeAuth } from "../../data/testing/fakeAuth";
import { SignInPage } from "./SignInPage";

async function sendTo(email: string) {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.click(
    screen.getByRole("button", { name: "Email me a sign-in link" }),
  );
}

describe("SignInPage", () => {
  it("shows the heading, the email field and the send button, focused on the email", () => {
    render(<SignInPage auth={createFakeAuth()} />);
    expect(
      screen.getByRole("heading", { name: "Sign in to Spec Studio" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("rejects an invalid email and sends nothing", async () => {
    const auth = createFakeAuth();
    render(<SignInPage auth={auth} />);
    await sendTo("nope");
    expect(screen.getByText("Enter an email address")).toBeInTheDocument();
    expect(auth.sent).toHaveLength(0);
  });

  it("sends the link with the page's redirect URL, then shows the code entry focused", async () => {
    const auth = createFakeAuth();
    render(<SignInPage auth={auth} />);
    await sendTo("pat@example.com");
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(
      screen.getByText("We sent a link and a 6-digit code to pat@example.com."),
    ).toBeInTheDocument();
    expect(auth.sent).toEqual([
      {
        email: "pat@example.com",
        redirectTo: window.location.origin + window.location.pathname,
      },
    ]);
    expect(screen.getByLabelText("6-digit code")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use a different email" }),
    ).toBeInTheDocument();
  });

  it("sends one email on a double click", async () => {
    const auth = createFakeAuth();
    render(<SignInPage auth={auth} />);
    await userEvent.type(screen.getByLabelText("Email"), "pat@example.com");
    await userEvent.dblClick(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    await screen.findByText("Check your email");
    expect(auth.sent).toHaveLength(1);
  });

  it("accepts only 6 digits", async () => {
    render(<SignInPage auth={createFakeAuth()} />);
    await sendTo("pat@example.com");
    await userEvent.type(await screen.findByLabelText("6-digit code"), "12ab");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter the 6-digit code")).toBeInTheDocument();
  });

  it("verifies the code", async () => {
    const auth = createFakeAuth();
    render(<SignInPage auth={auth} />);
    await sendTo("pat@example.com");
    await userEvent.type(
      await screen.findByLabelText("6-digit code"),
      FAKE_CODE,
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(async () =>
      expect((await auth.currentUser())?.email).toBe("pat@example.com"),
    );
  });

  it("shows a wrong code's message in a polite live region and keeps the code entry", async () => {
    render(<SignInPage auth={createFakeAuth()} />);
    await sendTo("pat@example.com");
    await userEvent.type(
      await screen.findByLabelText("6-digit code"),
      "000000",
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const message = await screen.findByText(new AuthError("badCode").message);
    expect(message.closest("[aria-live='polite']")).not.toBeNull();
    expect(screen.getByLabelText("6-digit code")).toBeInTheDocument();
  });

  it.each(["rateLimited", "offline", "failed"] as const)(
    "shows the %s copy when sending fails",
    async (reason) => {
      const error = new AuthError(reason);
      render(
        <SignInPage
          auth={createFakeAuth({ fail: { sendSignInEmail: error } })}
        />,
      );
      await sendTo("pat@example.com");
      expect(await screen.findByText(error.message)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Email me a sign-in link" }),
      ).toBeEnabled();
    },
  );

  it("goes back to the email, prefilled and focused, with Use a different email", async () => {
    render(<SignInPage auth={createFakeAuth()} />);
    await sendTo("pat@example.com");
    await userEvent.click(
      await screen.findByRole("button", { name: "Use a different email" }),
    );
    expect(screen.getByLabelText("Email")).toHaveValue("pat@example.com");
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("opens straight to the code entry, with an empty email, on an otherBrowser callback", () => {
    render(
      <SignInPage
        auth={createFakeAuth()}
        callbackError={new AuthError("otherBrowser")}
      />,
    );
    expect(screen.getByText(/different browser/)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("6-digit code")).toBeInTheDocument();
  });

  it("verifies with the email typed in the otherBrowser state", async () => {
    const auth = createFakeAuth();
    render(
      <SignInPage auth={auth} callbackError={new AuthError("otherBrowser")} />,
    );
    await userEvent.type(screen.getByLabelText("Email"), "pat@example.com");
    await userEvent.type(screen.getByLabelText("6-digit code"), FAKE_CODE);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(async () =>
      expect((await auth.currentUser())?.email).toBe("pat@example.com"),
    );
  });

  it("shows another callback error in the email state", () => {
    const error = new AuthError("badCode");
    render(<SignInPage auth={createFakeAuth()} callbackError={error} />);
    expect(screen.getByText(error.message)).toBeInTheDocument();
    expect(screen.queryByLabelText("6-digit code")).not.toBeInTheDocument();
  });
});
