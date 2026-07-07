import { describe, expect, it, beforeEach } from "vitest";
import {
  getNotificationPreferences,
  setNotificationPreferences,
} from "./preferences";

describe("notification preferences storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns defaults when nothing is stored", () => {
    const prefs = getNotificationPreferences();
    expect(prefs.soundEnabled).toBe(false);
    expect(prefs.desktopEnabled).toBe(false);
  });

  it("round-trips a written value", () => {
    setNotificationPreferences({
      soundEnabled: true,
      desktopEnabled: false,
    });
    const prefs = getNotificationPreferences();
    expect(prefs.soundEnabled).toBe(true);
    expect(prefs.desktopEnabled).toBe(false);
  });

  it("ignores malformed JSON without throwing", () => {
    window.localStorage.setItem(
      "huckleberry.notificationPreferences.v1",
      "{not valid json"
    );
    const prefs = getNotificationPreferences();
    expect(prefs.soundEnabled).toBe(false);
    expect(prefs.desktopEnabled).toBe(false);
  });

  it("ignores non-boolean fields without throwing", () => {
    window.localStorage.setItem(
      "huckleberry.notificationPreferences.v1",
      JSON.stringify({ soundEnabled: "yes", desktopEnabled: 1 })
    );
    const prefs = getNotificationPreferences();
    expect(prefs.soundEnabled).toBe(false);
    expect(prefs.desktopEnabled).toBe(false);
  });
});
