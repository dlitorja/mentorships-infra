"use client";

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
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

const CALENDAR_STATUS_QUERY_KEY = ["googleCalendarStatus"];
const CALENDARS_QUERY_KEY = ["googleCalendars"];
const GOOGLE_BOOKINGS_QUERY_KEY = ["googleBookings"];

const queryOptions = {
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 5,
} as const;

export function useGoogleCalendarStatus(enabled: boolean = true) {
  return useQuery({
    queryKey: CALENDAR_STATUS_QUERY_KEY,
    queryFn: fetchGoogleCalendarStatus,
    enabled,
    ...queryOptions,
  });
}

export function useSuspenseGoogleCalendarStatus() {
  return useSuspenseQuery({
    queryKey: CALENDAR_STATUS_QUERY_KEY,
    queryFn: fetchGoogleCalendarStatus,
    ...queryOptions,
  });
}

export function useGoogleCalendars(enabled: boolean = true) {
  return useQuery({
    queryKey: CALENDARS_QUERY_KEY,
    queryFn: fetchGoogleCalendars,
    enabled,
    ...queryOptions,
  });
}

export function useGoogleBookings(enabled: boolean = true) {
  return useQuery({
    queryKey: GOOGLE_BOOKINGS_QUERY_KEY,
    queryFn: fetchGoogleBookings,
    enabled,
    ...queryOptions,
  });
}

export function useSuspenseGoogleBookings() {
  return useSuspenseQuery({
    queryKey: GOOGLE_BOOKINGS_QUERY_KEY,
    queryFn: fetchGoogleBookings,
    ...queryOptions,
  });
}
