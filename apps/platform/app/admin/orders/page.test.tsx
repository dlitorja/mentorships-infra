import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "tests/unit/test-utils";
import AdminOrdersPage from "./page";

/**
 * The refund dialog used to be a hand-rolled overlay with no context: no
 * summary of what had already been refunded, no amount validation, only the
 * first payment ever refundable, and it closed on success with no receipt.
 */
const mocks = vi.hoisted(() => ({
  getAdminOrders: vi.fn(),
  createAdminRefund: vi.fn(),
}));

vi.mock("@/lib/queries/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/api-client")>(
    "@/lib/queries/api-client"
  );
  return {
    ...actual,
    getAdminOrders: mocks.getAdminOrders,
    createAdminRefund: mocks.createAdminRefund,
  };
});

const order = {
  id: "order_1234567890",
  userId: "user_student",
  userEmail: "student@example.com",
  status: "paid",
  provider: "stripe",
  totalAmount: "100.00",
  currency: "usd",
  createdAt: "2026-01-01T00:00:00.000Z",
  payments: [
    {
      id: "pay_1",
      provider: "stripe",
      providerPaymentId: "pi_1",
      amount: "100.00",
      currency: "usd",
      status: "completed",
      refundedAmount: "25.00",
    },
  ],
  packs: [
    {
      id: "pack_1",
      instructorId: "inst_1",
      instructorName: "Ada Instructor",
      instructorSlug: "ada",
      totalSessions: 4,
      remainingSessions: 1,
      status: "active",
      expiresAt: null,
    },
  ],
};

beforeEach(() => {
  mocks.getAdminOrders.mockReset().mockResolvedValue({
    items: [order],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  mocks.createAdminRefund.mockReset();
});

async function openRefundDialog() {
  renderWithProviders(<AdminOrdersPage />);
  fireEvent.click(await screen.findByRole("button", { name: /^refund$/i }));
  return screen.findByRole("dialog");
}

describe("Orders refund dialog", () => {
  it("shows paid, already-refunded and remaining amounts with order context", async () => {
    const dialog = await openRefundDialog();

    expect(dialog).toHaveTextContent(/student@example\.com/);
    expect(within(dialog).getByText("Already refunded")).toBeInTheDocument();
    // Paid 100.00, 25.00 already refunded → 75.00 refundable, and the full-refund
    // option names that remainder rather than the order total.
    expect(within(dialog).getAllByText("$100.00").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("$25.00").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("$75.00").length).toBeGreaterThan(0);
    expect(dialog).toHaveTextContent(/Ada Instructor/);
  });

  it("validates a partial amount against the remaining balance", async () => {
    const dialog = await openRefundDialog();

    fireEvent.click(within(dialog).getByLabelText(/partial/i));
    const amount = within(dialog).getByLabelText("Amount");

    fireEvent.change(amount, { target: { value: "500" } });
    expect(within(dialog).getByRole("button", { name: /\$500\.00/ })).toBeDisabled();

    fireEvent.change(amount, { target: { value: "10" } });
    expect(within(dialog).getByRole("button", { name: /\$10\.00/ })).toBeEnabled();
  });

  it("shows a receipt with the provider refund id instead of closing silently", async () => {
    mocks.createAdminRefund.mockResolvedValue({
      success: true,
      refund: {
        paymentId: "pay_1",
        amount: "75.00",
        currency: "usd",
        type: "full",
        reason: "Requested by customer",
        customReason: null,
        providerRefundId: "re_abc123",
        provider: "stripe",
      },
    });

    const dialog = await openRefundDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: /refund \$75\.00/i }));

    await waitFor(() =>
      expect(mocks.createAdminRefund).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: "pay_1", refundType: "full" })
      )
    );

    expect(await screen.findByText(/Refunded \$75\.00 via stripe/)).toBeInTheDocument();
    expect(screen.getByText(/re_abc123/)).toBeInTheDocument();
    // The list is refreshed behind the dialog, which stays open for the receipt.
    expect(mocks.getAdminOrders).toHaveBeenCalledTimes(2);
  });
});
