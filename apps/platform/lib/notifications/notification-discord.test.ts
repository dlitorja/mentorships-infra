import { describe, expect, it } from "vitest";
import { buildNotificationDiscordMessage } from "./notification-discord";

describe("buildNotificationDiscordMessage", () => {
  it("adds a readable prefix and includes message body", () => {
    const msg = buildNotificationDiscordMessage({
      type: "renewal_reminder",
      userId: "user_123",
      sessionPackId: "00000000-0000-0000-0000-000000000000",
      message: "Hello there",
      sessionNumber: 3,
    });

    expect(msg).toContain("Renewal reminder");
    expect(msg).toContain("Hello there");
  });

  it("handles grace period final warning", () => {
    const msg = buildNotificationDiscordMessage({
      type: "grace_period_final_warning",
      userId: "user_123",
      sessionPackId: "00000000-0000-0000-0000-000000000000",
      message: "Your grace period ends soon",
      gracePeriodEndsAt: new Date("2025-01-01T00:00:00.000Z"),
    });

    expect(msg).toContain("Grace period ending soon");
    expect(msg).toContain("Your grace period ends soon");
  });
});


