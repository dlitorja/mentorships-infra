"use client";

import { Button } from "@/components/ui/button";
import { Calendar, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import Link from "next/link";

type Props = {
  /** Whether the instructor has connected their Google Calendar */
  isCalendarConnected: boolean;
  /** Whether to show the "Manage Calendar" link to settings */
  showManageLink?: boolean;
};

/**
 * Displays the Google Calendar connection status for an instructor.
 * Shows a green "Connected" badge with a manage link, or an amber
 * "Not Connected" status with a button to connect.
 */
export function GoogleCalendarStatus({ isCalendarConnected, showManageLink = true }: Props) {
  if (isCalendarConnected) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span className="font-medium text-green-700">Google Calendar Connected</span>
        </div>
        {showManageLink && (
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings#integrations">
              Manage Calendar
              <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-amber-600" />
        <span className="font-medium text-amber-700">Google Calendar Not Connected</span>
      </div>
      <Button size="sm" asChild>
        <a href="/api/auth/google">
          <Calendar className="mr-1 h-4 w-4" />
          Connect Calendar
        </a>
      </Button>
    </div>
  );
}

type AlertBannerProps = {
  /** Whether the instructor has connected their Google Calendar */
  isCalendarConnected: boolean;
  /** Whether the instructor has set their time zone */
  hasTimeZone: boolean;
  /** Whether the instructor has configured working hours */
  hasWorkingHours: boolean;
};

/**
 * Shows a contextual alert banner prompting the instructor to complete
 * their Google Calendar setup. Returns null if setup is complete.
 */
export function GoogleCalendarAlertBanner({ isCalendarConnected, hasTimeZone, hasWorkingHours }: AlertBannerProps) {
  const isSetupComplete = isCalendarConnected && hasTimeZone && hasWorkingHours;

  if (isSetupComplete) {
    return null;
  }

  return (
    <div className="rounded-md border p-4 bg-amber-50 border-amber-200 text-amber-800">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isCalendarConnected ? (
            <>
              <Calendar className="h-5 w-5" />
              <div>
                <p className="font-medium">Complete Your Calendar Setup</p>
                <p className="text-sm">
                  Set your time zone and working hours so students can see when you&apos;re available.
                </p>
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">Connect Your Google Calendar</p>
                <p className="text-sm">
                  Connect your calendar so students can book sessions and avoid scheduling conflicts.
                </p>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isCalendarConnected && (
            <Button size="sm" variant="outline" asChild>
              <a href="/api/auth/google">
                <Calendar className="mr-1 h-4 w-4" />
                Connect
              </a>
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link href={isCalendarConnected ? "/instructor/settings" : "/instructor/onboarding"}>
              {isCalendarConnected ? "Set Availability" : "Complete Setup"}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}