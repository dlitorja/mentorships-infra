import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock Clerk useUser hook
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isSignedIn: false }),
}));

// Mock next/navigation useSearchParams
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<any>("next/navigation");
  return {
    ...actual,
    useSearchParams: () => new URLSearchParams("new=1&session_id=cs_test"),
  };
});

// Lazy import the component after mocks
import CheckoutSuccessPage from "@/app/checkout/success/page";

describe("Checkout Success Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Create Your Account CTA for new guest purchases", () => {
    render(<CheckoutSuccessPage />);
    // Button text from our edit
    expect(screen.getByText(/Create Your Account/i)).toBeInTheDocument();
  });
});
