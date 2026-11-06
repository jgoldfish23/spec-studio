import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthGateway, AuthUser } from "../../data/auth/authGateway";
import { createFakeAuth } from "../../data/testing/fakeAuth";
import { AuthProvider, useAuth } from "./AuthProvider";

const PAT: AuthUser = { id: "u-1", email: "pat@example.com" };

function Probe() {
  const { status, user } = useAuth();
  return (
    <p>
      {status}:{user?.email ?? "-"}
    </p>
  );
}

describe("AuthProvider", () => {
  it("is loading, then signedOut", async () => {
    const auth = createFakeAuth();
    render(
      <AuthProvider auth={auth}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByText("loading:-")).toBeInTheDocument();
    expect(await screen.findByText("signedOut:-")).toBeInTheDocument();
  });

  it("is loading, then signedIn when a session is stored", async () => {
    render(
      <AuthProvider auth={createFakeAuth({ user: PAT })}>
        <Probe />
      </AuthProvider>,
    );
    expect(
      await screen.findByText("signedIn:pat@example.com"),
    ).toBeInTheDocument();
  });

  it("follows sign-in and sign-out", async () => {
    const auth = createFakeAuth();
    render(
      <AuthProvider auth={auth}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signedOut:-");
    await act(() => auth.verifyCode("pat@example.com", "123456"));
    expect(screen.getByText("signedIn:pat@example.com")).toBeInTheDocument();
    await act(() => auth.signOut());
    expect(screen.getByText("signedOut:-")).toBeInTheDocument();
  });

  it("falls back to signedOut when the first read fails", async () => {
    const auth: AuthGateway = {
      ...createFakeAuth(),
      currentUser: () => Promise.reject(new Error("x")),
    };
    render(
      <AuthProvider auth={auth}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("signedOut:-")).toBeInTheDocument();
  });

  it("unsubscribes on unmount", async () => {
    const unsubscribe = vi.fn();
    const auth: AuthGateway = {
      ...createFakeAuth(),
      onChange: () => unsubscribe,
    };
    const { unmount } = render(
      <AuthProvider auth={auth}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signedOut:-");
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("useAuth outside the provider throws a clear error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
  });
});
