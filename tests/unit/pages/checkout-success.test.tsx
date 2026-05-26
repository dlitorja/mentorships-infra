import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockSearch = "new=1&session_id=cs_test";
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
  useUser: () => ({ isSignedIn: false }),
}));
import CheckoutSuccessPage from "../../../apps/platform/app/checkout/success/page";

describe("Checkout Success Page", () => {
  let qc: QueryClient;
  beforeEach(() => {
    (globalThis as any).__TEST_IS_SIGNED_IN__ = false;
    qc = new QueryClient();
  });

  it("shows Create Your Account CTA for new guest purchases", () => {
    (globalThis as any).__TEST_IS_SIGNED_IN__ = false;
    (globalThis as any).__TEST_IS_NEW__ = true;
    render(
      <QueryClientProvider client={qc}>
        <CheckoutSuccessPage />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Create Your Account/i)).toBeInTheDocument();
  });

  it("shows Go to Dashboard for signed-in users (even with new=1)", () => {
    (globalThis as any).__TEST_IS_SIGNED_IN__ = true;
    (globalThis as any).__TEST_IS_NEW__ = true;
    render(
      <QueryClientProvider client={qc}>
        <CheckoutSuccessPage />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Go to Dashboard/i)).toBeInTheDocument();
  });

  it("shows Go to Dashboard when new is not present and user is not signed in", () => {
    (globalThis as any).__TEST_IS_SIGNED_IN__ = false;
    (globalThis as any).__TEST_IS_NEW__ = false;
    render(
      <QueryClientProvider client={qc}>
        <CheckoutSuccessPage />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Go to Dashboard/i)).toBeInTheDocument();
  });
});
