"use client";

import { useEffect, useState } from "react";

interface CountdownTimerProps {
  endDate: Date;
  title: string;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calculateTimeLeft(endDate: Date): TimeLeft | null {
  const now = new Date();
  const difference = endDate.getTime() - now.getTime();

  if (difference <= 0) {
    return null;
  }

  return {
    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((difference / 1000 / 60) % 60),
    seconds: Math.floor((difference / 1000) % 60),
  };
}

export function CountdownTimer({ endDate, title }: CountdownTimerProps): React.JSX.Element {
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);

  useEffect(() => {
    setTimeLeft(calculateTimeLeft(endDate));

    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(endDate));
    }, 1000);

    return () => clearInterval(timer);
  }, [endDate]);

  if (!timeLeft) {
    return (
      <div className="mb-8 p-6 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
        <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 text-center">
          Sale ended
        </h2>
      </div>
    );
  }

  return (
    <div className="mb-8 p-6 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950 border border-orange-200 dark:border-orange-800 rounded-lg">
      <h2 className="text-2xl font-bold text-orange-600 dark:text-orange-400 text-center mb-4">
        {title}
      </h2>
      <div className="flex justify-center gap-4 md:gap-6">
        <div className="text-center">
          <div className="text-3xl md:text-4xl font-bold text-red-600 dark:text-red-400 tabular-nums">
            {String(timeLeft.days).padStart(2, "0")}
          </div>
          <div className="text-xs md:text-sm text-muted-foreground uppercase tracking-wide">
            Days
          </div>
        </div>
        <div className="text-2xl md:text-3xl font-bold text-muted-foreground">:</div>
        <div className="text-center">
          <div className="text-3xl md:text-4xl font-bold text-red-600 dark:text-red-400 tabular-nums">
            {String(timeLeft.hours).padStart(2, "0")}
          </div>
          <div className="text-xs md:text-sm text-muted-foreground uppercase tracking-wide">
            Hours
          </div>
        </div>
        <div className="text-2xl md:text-3xl font-bold text-muted-foreground">:</div>
        <div className="text-center">
          <div className="text-3xl md:text-4xl font-bold text-red-600 dark:text-red-400 tabular-nums">
            {String(timeLeft.minutes).padStart(2, "0")}
          </div>
          <div className="text-xs md:text-sm text-muted-foreground uppercase tracking-wide">
            Minutes
          </div>
        </div>
        <div className="text-2xl md:text-3xl font-bold text-muted-foreground">:</div>
        <div className="text-center">
          <div className="text-3xl md:text-4xl font-bold text-red-600 dark:text-red-400 tabular-nums">
            {String(timeLeft.seconds).padStart(2, "0")}
          </div>
          <div className="text-xs md:text-sm text-muted-foreground uppercase tracking-wide">
            Seconds
          </div>
        </div>
      </div>
    </div>
  );
}