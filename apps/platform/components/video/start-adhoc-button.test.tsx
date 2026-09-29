// Unit tests for the platform-call-bugs branch's `StartAdhocButton`
// defense-in-depth `useIsInCall()` gate. The button historically was
// gated on `!session && !isSessionLoading` only, which let it flash
// visible during the brief `meetingState === "left-meeting"` window
// when a network blip flips Daily's local status to `"idle"`. The
// composite `!isInCall && !session && !isSessionLoading` gate in
// `start-adhoc-button.tsx` closes that window so the user never sees
// "Start video call" while a call is in progress.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  useVideoCallContext: vi.fn(),
  useIsInCall: vi.fn(),
  startAdhocCall: vi.fn(),
  useMutation: vi.fn(),
  queryClientInvalidate: vi.fn(),
}));

vi.mock("@/lib/video/video-context", () => ({
  useVideoCallContext: () => mocks.useVideoCallContext(),
  useIsInCall: () => mocks.useIsInCall(),
}));

vi.mock("@/lib/queries/api-client", () => ({
  startAdhocCall: (...args: unknown[]) => mocks.startAdhocCall(...args),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (config: { mutationFn: unknown; onSuccess?: () => void }) => {
    // Capture the onSuccess so the test can exercise the
    // invalidateQueries path if it wants.
    mocks.useMutation(config);
    return {
      mutateAsync: vi.fn(),
      isPending: false,
    };
  },
  useQueryClient: () => ({
    invalidateQueries: (...args: unknown[]) => mocks.queryClientInvalidate(...args),
  }),
}));

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: () => vi.fn(),
}));

vi.mock("@/components/video/consent-modal", () => ({
  ConsentModal: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => {
    return React.createElement("button", props, children);
  },
}));

vi.mock("@/lib/observability", () => ({
  reportError: vi.fn(),
}));

// Imported AFTER mocks so the component module sees them.
import { StartAdhocButton } from "./start-adhoc-button";

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

const renderButton = (
  overrides: Partial<{
    isInCall: boolean;
    session: unknown;
    isSessionLoading: boolean;
  }> = {}
) => {
  mocks.useIsInCall.mockReturnValue(overrides.isInCall ?? false);
  mocks.useVideoCallContext.mockReturnValue({
    session: overrides.session ?? null,
    isSessionLoading: overrides.isSessionLoading ?? false,
    requestJoin: vi.fn(),
  });
  return render(<StartAdhocButton workspaceId={"ws_test" as never} />);
};

describe("<StartAdhocButton> useIsInCall() gate (platform-call-bugs)", () => {
  it("returns null when isInCall is true even if session is null (Bug 1 guard)", () => {
    const { container } = renderButton({ isInCall: true, session: null });
    expect(container.firstChild).toBeNull();
  });

  it("returns null when isInCall is true even if session is loading", () => {
    const { container } = renderButton({
      isInCall: true,
      isSessionLoading: true,
      session: null,
    });
    expect(container.firstChild).toBeNull();
  });

  it("still hides when session is non-null even if isInCall is false (existing behavior)", () => {
    const { container } = renderButton({
      isInCall: false,
      session: { sessionId: "session_test" },
    });
    expect(container.firstChild).toBeNull();
  });

  it("shows the loading placeholder while session is loading and not in call (existing behavior)", () => {
    const { getByLabelText } = renderButton({
      isInCall: false,
      isSessionLoading: true,
      session: undefined,
    });
    expect(getByLabelText("Checking for active call")).toBeTruthy();
  });

  it("shows the Start button when not in call, no session, and not loading", () => {
    const { getByRole } = renderButton({
      isInCall: false,
      isSessionLoading: false,
      session: null,
    });
    const button = getByRole("button", { name: /start video call/i });
    expect(button).toBeTruthy();
  });
});
