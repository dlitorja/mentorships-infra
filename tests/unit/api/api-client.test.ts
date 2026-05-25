import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCheckoutSession } from "../../../apps/platform/lib/queries/api-client";

describe("api-client createCheckoutSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends email and fullName for guest checkout", async () => {
    const fetchSpy = vi.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://stripe.test/checkout" }),
    } as any);

    await createCheckoutSession({ productId: "prod_1", email: "a@b.com", fullName: "Ada Lovelace" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/checkout/stripe");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ productId: "prod_1", email: "a@b.com", fullName: "Ada Lovelace" });
  });
});
