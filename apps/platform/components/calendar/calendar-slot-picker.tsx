"use client";

import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

function slotDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type CalendarSlotPickerProps = {
  slots: string[];
  selectedSlot: string | null;
  onSelectSlot: (iso: string) => void;
  onNavigate?: () => void;
};

/**
 * Monthly calendar slot picker component.
 * Displays available days with time slots grouped by day.
 * Users select a day to see available times, then select a specific slot.
 *
 * @param slots - Array of ISO datetime strings representing available booking slots
 * @param selectedSlot - Currently selected slot ISO string (or null)
 * @param onSelectSlot - Callback fired when a time slot is selected
 * @param onNavigate - Optional callback fired when user navigates between months
 */
export function CalendarSlotPicker({ slots, selectedSlot, onSelectSlot, onNavigate }: CalendarSlotPickerProps) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [viewYear, setViewYear] = React.useState(() => today.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(() => today.getMonth());
  const [selectedDay, setSelectedDay] = React.useState<number | null>(null);

  const days = useMemo(() => buildCalendarDays(viewYear, viewMonth), [viewYear, viewMonth]);

  const slotsByDay = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const iso of slots) {
      const key = slotDateKey(iso);
      if (!result[key]) result[key] = [];
      result[key].push(iso);
    }
    for (const key in result) {
      result[key].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    }
    return result;
  }, [slots]);

  const availableDays = useMemo(() => {
    const prefix = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-`;
    const result = new Set<string>();
    for (const key of Object.keys(slotsByDay)) {
      if (key.startsWith(prefix)) {
        const day = key.slice(prefix.length);
        result.add(day);
      }
    }
    return result;
  }, [slotsByDay, viewYear, viewMonth]);

  const monthName = useMemo(
    () => new Date(viewYear, viewMonth, 1).toLocaleString("en-US", { month: "long", year: "numeric" }),
    [viewYear, viewMonth]
  );

  function prevMonth() {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
    setSelectedDay(null);
    onNavigate?.();
  }

  function nextMonth() {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
    setSelectedDay(null);
    onNavigate?.();
  }

  function daySlots(day: number): string[] {
    const key = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return slotsByDay[key] ?? [];
  }

  const selectedDaySlots = selectedDay !== null ? daySlots(selectedDay) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={prevMonth} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-medium text-sm">{monthName}</span>
        <Button variant="ghost" size="icon" onClick={nextMonth} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-xs text-muted-foreground py-1 font-medium">
            {d}
          </div>
        ))}
        {days.map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} />;
          const isAvailable = availableDays.has(String(day).padStart(2, "0"));
          const isPast = new Date(viewYear, viewMonth, day) < today;
          const isSelected = selectedDay === day;
          return (
            <button
              key={day}
              type="button"
              disabled={isPast || !isAvailable}
              onClick={() => setSelectedDay(day)}
              className={[
                "h-9 w-full text-xs rounded-md border transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary"
                  : isAvailable && !isPast
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                  : "bg-muted/30 text-muted-foreground border-transparent cursor-not-allowed opacity-40",
              ].join(" ")}
              aria-label={
                isAvailable
                  ? `${new Date(viewYear, viewMonth, day).toLocaleDateString("en-US", { month: "long", day: "numeric" })} has ${daySlots(day).length} slots available`
                  : undefined
              }
            >
              {day}
            </button>
          );
        })}
      </div>

      {selectedDay !== null && (
        <div className="border-t pt-4">
          <p className="text-sm font-medium mb-2">
            Available times for{" "}
            {new Date(viewYear, viewMonth, selectedDay).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          {selectedDaySlots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No slots available this day.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {selectedDaySlots.map((iso) => {
                const d = new Date(iso);
                return (
                  <Button
                    key={iso}
                    variant="outline"
                    size="sm"
                    onClick={() => onSelectSlot(iso)}
                    className={selectedSlot === iso ? "border-primary bg-primary/10" : ""}
                  >
                    {d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}