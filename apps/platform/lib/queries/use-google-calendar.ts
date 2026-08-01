"use client";

import { useQuery, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/nextjs";
import { ApiFetchError, getGoogleCalendars, getMyBookings } from "./api-client";

export type GoogleCalendarStatus = { connected: boolean };
export type Calendar = {
  id: string;
  summary: string;
  accessRole: string;
  primary: boolean;
};
export type CalendarsResponse = {
  connected: boolean;
  calendars: Calendar[];
  selected: {
    eventCalendarId: string;
    availabilityCalendarIds: string[];
  };
};
export type GoogleBooking = {
  id: string;
  startUtc: number;
  endUtc: number;
  status: "pending" | "confirmed" | "canceled" | "completed";
};

async function fetchGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  try {
    await getGoogleCalendars();
    return { connected: true };
  } catch (e) {
    if (e instanceof ApiFetchError && e.status === 409) {
      return { connected: false };
    }
    throw e;
  }
}

async function fetchGoogleBookings(): Promise<GoogleBooking[]> {
  const json = await getMyBookings();
  return json.success ? (json.bookings ?? []) : [];
}

async function fetchGoogleCalendars(): Promise<CalendarsResponse> {
  const data = await getGoogleCalendars();
  return data;
}

function googleCalendarQueryKey(userId: string | undefined, name: string) {
  return ["googleCalendar", userId ?? "anonymous", name];
}

const queryOptions = {
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 5,
} as const;

export function useGoogleCalendarStatus(enabled: boolean = true) {
  const { user } = useUser();
  return useQuery({
    queryKey: googleCalendarQueryKey(user?.id, "status"),
    queryFn: fetchGoogleCalendarStatus,
    enabled,
    ...queryOptions,
  });
}

export function useSuspenseGoogleCalendarStatus() {
  const { user } = useUser();
  return useSuspenseQuery({
    queryKey: googleCalendarQueryKey(user?.id, "status"),
    queryFn: fetchGoogleCalendarStatus,
    ...queryOptions,
  });
}

export function useGoogleCalendars(enabled: boolean = true) {
  const { user } = useUser();
  return useQuery({
    queryKey: googleCalendarQueryKey(user?.id, "calendars"),
    queryFn: fetchGoogleCalendars,
    enabled,
    ...queryOptions,
  });
}

export function useGoogleBookings(enabled: boolean = true) {
  const { user } = useUser();
  return useQuery({
    queryKey: googleCalendarQueryKey(user?.id, "bookings"),
    queryFn: fetchGoogleBookings,
    enabled,
    ...queryOptions,
  });
}

export function useSuspenseGoogleBookings() {
  const { user } = useUser();
  return useSuspenseQuery({
    queryKey: googleCalendarQueryKey(user?.id, "bookings"),
    queryFn: fetchGoogleBookings,
    ...queryOptions,
  });
}

/**
 * Invalidate all Google Calendar-related queries for the current user.
 * Call this after connecting/disconnecting or selecting calendars.
 */
export function useInvalidateGoogleCalendarQueries() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  return () => {
    queryClient.invalidateQueries({
      queryKey: googleCalendarQueryKey(user?.id, "status"),
    });
    queryClient.invalidateQueries({
      queryKey: googleCalendarQueryKey(user?.id, "calendars"),
    });
    queryClient.invalidateQueries({
      queryKey: googleCalendarQueryKey(user?.id, "bookings"),
    });
  };
}
