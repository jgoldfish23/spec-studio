import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { AuthError } from "../../data/auth/authGateway";
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

describe("AuthProvider when the server can't be reached at startup", () => {
  function Retrying() {
    const { status, user, retry } = useAuth();
    return (
      <>
        <p>
          {status}:{user?.email ?? "-"}
        </p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </>
    );
  }

  it("is unreachable, not signed out, when reading the session fails offline; retry reads it again", async () => {
    const auth = createFakeAuth({ user: PAT });
    const read = vi
      .spyOn(auth, "currentUser")
      .mockRejectedValueOnce(new AuthError("offline"));
    render(
      <AuthProvider auth={auth}>
        <Retrying />
      </AuthProvider>,
    );
    expect(await screen.findByText("unreachable:-")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("signedIn:pat@example.com"),
    ).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("is loading again while the retry reads", async () => {
    const auth = createFakeAuth({ user: PAT });
    let answer!: (user: AuthUser | null) => void;
    vi.spyOn(auth, "currentUser")
      .mockRejectedValueOnce(new AuthError("offline"))
      .mockImplementationOnce(
        () => new Promise((resolve) => (answer = resolve)),
      );
    render(
      <AuthProvider auth={auth}>
        <Retrying />
      </AuthProvider>,
    );
    await screen.findByText("unreachable:-");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("loading:-")).toBeInTheDocument();
    await act(async () => answer(null));
    expect(screen.getByText("signedOut:-")).toBeInTheDocument();
  });

  it("follows a sign-in that arrives while unreachable", async () => {
    const auth = createFakeAuth();
    vi.spyOn(auth, "currentUser").mockRejectedValueOnce(
      new AuthError("offline"),
    );
    render(
      <AuthProvider auth={auth}>
        <Retrying />
      </AuthProvider>,
    );
    await screen.findByText("unreachable:-");
    await act(() => auth.verifyCode(PAT.email, "123456"));
    expect(screen.getByText("signedIn:pat@example.com")).toBeInTheDocument();
  });

  it("still treats any other failed read as signed out", async () => {
    const auth = createFakeAuth({ user: PAT });
    vi.spyOn(auth, "currentUser").mockRejectedValueOnce(
      new AuthError("failed"),
    );
    render(
      <AuthProvider auth={auth}>
        <Retrying />
      </AuthProvider>,
    );
    expect(await screen.findByText("signedOut:-")).toBeInTheDocument();
  });
});

describe("AuthProvider re-renders", () => {
  it("skips a change that reports the same user", async () => {
    const auth = createFakeAuth({ user: PAT });
    const commits = { count: 0 };
    function Counting() {
      const state = useAuth();
      useEffect(() => {
        commits.count += 1;
      }, [state]);
      return <p>{state.status}</p>;
    }
    render(
      <AuthProvider auth={auth}>
        <Counting />
      </AuthProvider>,
    );
    await screen.findByText("signedIn");
    const settled = commits.count;
    await act(() => auth.verifyCode(PAT.email, "123456")); // a different id: a real change
    const afterChange = commits.count;
    expect(afterChange).toBeGreaterThan(settled);
    await act(() => auth.verifyCode(PAT.email, "123456")); // the same user again
    expect(commits.count).toBe(afterChange);
  });
});
