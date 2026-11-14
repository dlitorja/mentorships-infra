import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import InstructorError from "./error";

afterEach(cleanup);

describe("instructor route error boundary", () => {
  it("retries with Next's refetching `retry`, not the non-refetching `reset`", () => {
    // Greptile P1: `reset()` only clears the boundary state, so a failed
    // server render (the Convex token mint) is replayed instead of
    // re-attempted and the instructor stays stuck. `retry()` re-fetches
    // and re-renders the segment, which re-runs the server component.
    const retry = vi.fn();
    const reset = vi.fn();

    render(<InstructorError error={new Error("boom")} retry={retry} reset={reset} />);
    screen.getByRole("button", { name: /try again/i }).click();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("falls back to `reset` when Next does not provide `retry`", () => {
    const reset = vi.fn();

    render(<InstructorError error={new Error("boom")} reset={reset} />);
    screen.getByRole("button", { name: /try again/i }).click();

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows the digest but never the server error message", () => {
    render(
      <InstructorError
        error={Object.assign(new Error("ECONNRESET talking to clerk.internal"), {
          digest: "2031266799",
        })}
        retry={vi.fn()}
      />,
    );

    expect(screen.getByText(/2031266799/)).toBeTruthy();
    expect(screen.queryByText(/ECONNRESET/)).toBeNull();
  });

  it("tolerates a non-Error thrown value", () => {
    // Next forwards client-thrown values as-is; they may be strings.
    render(<InstructorError error={"plain string rejection"} retry={vi.fn()} />);

    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.queryByText(/plain string rejection/)).toBeNull();
  });
});
