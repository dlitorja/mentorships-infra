import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import InstructorError from "./error";

afterEach(cleanup);

describe("instructor route error boundary", () => {
  it("offers a retry without leaking the server error message", () => {
    const reset = vi.fn();
    render(
      <InstructorError
        error={
          Object.assign(new Error("ECONNRESET talking to clerk.internal"), {
            digest: "2031266799",
          }) as Error & { digest?: string }
        }
        reset={reset}
      />,
    );

    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.getByText(/2031266799/)).toBeTruthy();
    expect(screen.queryByText(/ECONNRESET/)).toBeNull();
  });

  it("retries the segment when the button is pressed", () => {
    const reset = vi.fn();
    render(<InstructorError error={new Error("boom")} reset={reset} />);

    screen.getByRole("button", { name: /try again/i }).click();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
