import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockSearch = "session_id=cs_test";
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<any>("next/navigation");
  return {
    ...actual,
    useSearchParams: () => new URLSearchParams(mockSearch),
  };
});
// Ensure useUser is harmless in a unit-test environment without ClerkProvider
vi.mock("@clerk/nextjs", () => ({
  __esModule: true,
  useUser: () => ({ isSignedIn: Boolean((globalThis as any).__TEST_IS_SIGNED_IN__) }),
}));
import CheckoutSuccessPage from "../../../apps/platform/app/checkout/success/page";

describe("Checkout Success Page", () => {
  let qc: QueryClient;
  beforeEach(() => {
    (globalThis as any).__TEST_IS_SIGNED_IN__ = false;
    qc = new QueryClient();
  });

  it("shows email-check guidance for new guest purchases", () => {
    (globalThis as any).__TEST_IS_SIGNED_IN__ = false;
    mockSearch = "session_id=cs_test&new=1";
    render(
      <QueryClientProvider client={qc}>
        <CheckoutSuccessPage />
      </QueryClientProvider>
    );
    expect(screen.getByText(/sent a sign-in link to your email/i)).toBeInTheDocument();
  });

  it("shows Go to Dashboard for signed-in users", () => {
    (globalThis as any).__TEST_IS_SIGNED_IN__ = true;
    render(
      <QueryClientProvider client={qc}>
        <CheckoutSuccessPage />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Go to Dashboard/i)).toBeInTheDocument();
  });

  it("shows sign-in CTA for returning students (no new/guest flag)", () => {
    (globalThis as any).__TEST_IS_SIGNED_IN__ = false;
    mockSearch = "session_id=cs_test";
    render(
      <QueryClientProvider client={qc}>
        <CheckoutSuccessPage />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Sign In to Your Account/i)).toBeInTheDocument();
  });
});
