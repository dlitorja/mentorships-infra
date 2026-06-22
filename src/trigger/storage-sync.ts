import { schedules, task, logger } from "@trigger.dev/sdk";

export const cleanupExpiredStorage = schedules.task({
  id: "cleanup-expired-storage",
  cron: "0 3 * * *",
  run: async (payload, { ctx }) => {
    logger.info("Starting daily expired storage cleanup", {
      timestamp: payload.timestamp,
      lastTimestamp: payload.lastTimestamp,
    });

    try {
      const cleanupUrl = process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/api/storage/cleanup`
        : "http://localhost:3000/api/storage/cleanup";

      const response = await fetch(cleanupUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Cleanup request failed", {
          status: response.status,
          error: errorText,
        });
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const result = await response.json();

      logger.info("Expired storage cleanup completed", {
        cleanupId: result.cleanupId,
        totalToCleanup: result.totalToCleanup,
        cleanedUp: result.cleanedUp,
        failed: result.failed,
        status: result.status,
      });

      return {
        success: result.success,
        cleanupId: result.cleanupId,
        totalToCleanup: result.totalToCleanup,
        cleanedUp: result.cleanedUp,
        failed: result.failed,
        status: result.status,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Expired storage cleanup failed", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  },
});

interface ManualCleanupPayload {
  type: "manual";
  triggeredBy: string;
}

export const manualStorageCleanup = task({
  id: "manual-storage-cleanup",
  run: async (payload: ManualCleanupPayload) => {
    logger.info("Manual storage cleanup triggered", {
      triggeredBy: payload.triggeredBy,
    });

    const cleanupUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/storage/cleanup`
      : "http://localhost:3000/api/storage/cleanup";

    const response = await fetch(cleanupUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cleanup failed: HTTP ${response.status} - ${errorText}`);
    }

    return await response.json();
  },
});