import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock observability with spies we can assert on (mock via alias path)
const reportInfo = vi.fn().mockResolvedValue(undefined);
const reportError = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/observability", () => ({
  reportInfo,
  reportError,
}));

// Helper to build a mock Clerk client
function createMockClerkClient({
  emailId = "email_1",
  getUserImpl,
  prepareImpl,
}: {
  emailId?: string;
  getUserImpl?: () => Promise<any>;
  prepareImpl?: () => Promise<any>;
} = {}) {
  return {
    users: {
      getUser: vi.fn(getUserImpl ?? (async () => ({ emailAddresses: [{ id: emailId }] }))),
    },
    emailAddresses: {
      prepareVerification: vi.fn(prepareImpl ?? (async () => undefined)),
    },
  };
}

// Provide a test-only override for the Clerk client used by the helper
let mockClient = createMockClerkClient();

describe("sendEmailLinkForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClerkClient();
    (globalThis as any).__TEST_CLERK_CLIENT__ = mockClient;
  });

  it("succeeds on first attempt", async () => {
    const mod = await import("../../../apps/platform/lib/clerk-magic-links");
    const res = await mod.sendEmailLinkForUser("user_1", "https://example.com/auth-redirect");

    expect(res).toEqual({ ok: true });
    expect(mockClient.users.getUser).toHaveBeenCalledTimes(1);
    expect(mockClient.emailAddresses.prepareVerification).toHaveBeenCalledTimes(1);
    expect(reportInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "clerk/magic-links",
        message: "Magic link sent",
      })
    );
  });

  it("retries on transient failure then succeeds", async () => {
    let called = 0;
    mockClient = createMockClerkClient({
      prepareImpl: async () => {
        called += 1;
        if (called === 1) {
          const err: any = new Error("server error");
          err.status = 500;
          throw err;
        }
        return undefined;
      },
    });
    (globalThis as any).__TEST_CLERK_CLIENT__ = mockClient;

    const mod = await import("../../../apps/platform/lib/clerk-magic-links");
    const res = await mod.sendEmailLinkForUser("user_1", "https://example.com/auth-redirect");

    expect(res).toEqual({ ok: true });
    expect(mockClient.emailAddresses.prepareVerification).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "clerk/magic-links",
        message: "Magic link send failed",
        level: "warn",
      })
    );
  });

  it("does not retry on 4xx (except 429)", async () => {
    mockClient = createMockClerkClient({
      prepareImpl: async () => {
        const err: any = new Error("bad request");
        err.status = 400;
        throw err;
      },
    });
    (globalThis as any).__TEST_CLERK_CLIENT__ = mockClient;

    const mod = await import("../../../apps/platform/lib/clerk-magic-links");
    const res = await mod.sendEmailLinkForUser("user_1", "https://example.com/auth-redirect");

    expect(res.ok).toBe(false);
    expect(mockClient.emailAddresses.prepareVerification).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "clerk/magic-links",
        message: "Magic link send failed",
        level: "error",
      })
    );
  });

  it("logs invalid redirectUrl but proceeds", async () => {
    const mod = await import("../../../apps/platform/lib/clerk-magic-links");
    const res = await mod.sendEmailLinkForUser("user_1", "not-a-url");

    expect(res).toEqual({ ok: true });
    expect(reportInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "clerk/magic-links",
        level: "warn",
        message: "Invalid redirectUrl",
      })
    );
  });

  it("respects ENABLE_MAGIC_LINKS flag", async () => {
    process.env.ENABLE_MAGIC_LINKS = "false";
    const mod = await import("../../../apps/platform/lib/clerk-magic-links");
    const res = await mod.sendEmailLinkForUser("user_1", "https://example.com/auth-redirect");
    expect(res).toEqual({ ok: true });
    expect(mockClient.emailAddresses.prepareVerification).not.toHaveBeenCalled();
    expect(reportInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "clerk/magic-links",
        message: "Magic link send skipped by flag",
      })
    );
    delete process.env.ENABLE_MAGIC_LINKS;
  });
});
