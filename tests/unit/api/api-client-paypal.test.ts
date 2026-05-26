import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPayPalCheckoutSession } from "../../../apps/platform/lib/queries/api-client";

describe("api-client createPayPalCheckoutSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends email and fullName for guest checkout (productId)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({ orderId: "ord_1", url: "https://paypal.test/checkout" }),
    } as any);

    await createPayPalCheckoutSession({ productId: "prod_1", email: "a@b.com", fullName: "Ada Lovelace" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/checkout/paypal");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ productId: "prod_1", email: "a@b.com", fullName: "Ada Lovelace" });
  });
});
