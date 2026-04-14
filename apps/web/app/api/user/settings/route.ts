import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser, getUser } from "@/lib/auth";
import { updateUserTimeZone } from "@mentorships/db";

const updateTimeZoneSchema = z.object({
  timeZone: z.string().min(1, "Timezone is required"),
});

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireDbUser();

    const body = await req.json();
    const parsed = updateTimeZoneSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { timeZone } = parsed.data;

    const validTimeZones = getValidTimeZones();
    if (!validTimeZones.includes(timeZone)) {
      return NextResponse.json(
        { error: "Invalid timezone" },
        { status: 400 }
      );
    }

    await updateUserTimeZone(user.id, timeZone);

    return NextResponse.json({ success: true, timeZone });
  } catch (error) {
    console.error("Update user settings error:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireDbUser();
    const clerkUser = await getUser();

    const discordConnected = clerkUser?.externalAccounts?.some(
      (a) => a.provider?.toLowerCase?.().includes("discord")
    ) ?? false;

    return NextResponse.json({
      userId: user.id,
      email: user.email,
      timeZone: user.timeZone,
      discordConnected,
    });
  } catch (error) {
    console.error("Get user settings error:", error);
    return NextResponse.json(
      { error: "Failed to get settings" },
      { status: 500 }
    );
  }
}

function getValidTimeZones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] })
    .supportedValuesOf;
  if (typeof fn === "function") {
    try {
      return fn("timeZone");
    } catch {
      return fallbackTimeZones;
    }
  }
  return fallbackTimeZones;
}

const fallbackTimeZones = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Prague",
  "Europe/Athens",
  "Europe/Helsinki",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];
