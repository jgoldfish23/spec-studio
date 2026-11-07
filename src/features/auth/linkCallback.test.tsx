import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError } from "../../data/auth/authGateway";
import { createFakeAuth } from "../../data/testing/fakeAuth";
import { handleLinkCallback, redirectUrl } from "./linkCallback";
import { SignInPage } from "./SignInPage";

function setUrl(path: string) {
  window.history.replaceState(null, "", path);
}

afterEach(() => setUrl("/"));

describe("redirectUrl", () => {
  it("is origin plus pathname, with no query and no hash", () => {
    setUrl("/app/?x=1#/deals");
    expect(redirectUrl(window.location)).toBe(`${window.location.origin}/app/`);
  });
});

describe("handleLinkCallback", () => {
  it("signs in with ?code= and leaves the hash route in the URL", async () => {
    const auth = createFakeAuth();
    setUrl("/?code=abc#/deals/7");
    const result = await handleLinkCallback(window.location, auth);
    expect(result).toEqual({ handled: true });
    expect(await auth.currentUser()).not.toBeNull();
    expect(window.location.href).toBe(`${window.location.origin}/#/deals/7`);
  });

  it("goes to #/deals when there is no hash", async () => {
    setUrl("/?code=abc");
    await handleLinkCallback(window.location, createFakeAuth());
    expect(window.location.href).toBe(`${window.location.origin}/#/deals`);
  });

  it("is not handled without a code, and leaves the URL alone", async () => {
    setUrl("/?other=1#/deals");
    const result = await handleLinkCallback(window.location, createFakeAuth());
    expect(result).toEqual({ handled: false });
    expect(window.location.search).toBe("?other=1");
  });

  it("strips the code and reports the error when the exchange fails", async () => {
    setUrl("/?code=abc#/deals");
    const error = new AuthError("badCode");
    const result = await handleLinkCallback(
      window.location,
      createFakeAuth({ fail: { exchangeLinkCode: error } }),
    );
    expect(result).toEqual({ handled: true, error });
    expect(window.location.search).toBe("");
  });

  it("an otherBrowser failure opens the sign-in page with the message and the code entry", async () => {
    setUrl("/?code=abc#/deals");
    const auth = createFakeAuth({
      fail: { exchangeLinkCode: new AuthError("otherBrowser") },
    });
    const result = await handleLinkCallback(window.location, auth);
    render(<SignInPage auth={auth} callbackError={result.error} />);
    const message = screen.getByRole("alert");
    expect(message).toHaveTextContent(/opened in a different browser/);
    expect(
      message.compareDocumentPosition(screen.getByLabelText("6-digit code")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("6-digit code")).toBeInTheDocument();
  });
});
