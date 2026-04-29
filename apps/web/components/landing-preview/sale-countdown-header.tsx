"use client";

import { useCallback, useEffect, useState } from "react";

const SALE_ENDS_AT = "2026-05-05T23:59:59.000Z";

function useCountdown(targetDate: string | null) {
  const calculate = useCallback(() => {
    if (!targetDate) return null;
    const target = new Date(targetDate).getTime();
    const now = Date.now();
    const diff = target - now;
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / (1000 * 60)) % 60),
      seconds: Math.floor((diff / 1000) % 60),
    };
  }, [targetDate]);

  const [timeLeft, setTimeLeft] = useState(calculate);
  useEffect(() => {
    const result = calculate();
    setTimeLeft(result);
    if (!result) return;
    const interval = setInterval(() => setTimeLeft(calculate()), 1000);
    return () => clearInterval(interval);
  }, [calculate]);
  return timeLeft;
}

export function SaleCountdownHeader() {
  const timeLeft = useCountdown(SALE_ENDS_AT);

  return (
    <section className="bg-white px-6 pt-10">
      <div className="mx-auto max-w-5xl text-center">
        <a
          href="https://home.huckleberry.art/resource_redirect/offers/gkAXKN2g"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-base sm:text-lg font-semibold uppercase tracking-wider text-white bg-[#dc2626] hover:bg-[#b91c1c] px-6 py-3 shadow-md"
        >
          Neil Gray Courses Sale · Up to 67% Off
        </a>
        {timeLeft && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <div className="text-[#1a1a2e]/80 text-xs uppercase tracking-widest">
              Sale Ends In
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              {[
                { value: timeLeft.days, label: "Days" },
                { value: timeLeft.hours, label: "Hrs" },
                { value: timeLeft.minutes, label: "Min" },
                { value: timeLeft.seconds, label: "Sec" },
              ].map((unit) => (
                <div
                  key={unit.label}
                  className="rounded bg-[#1a1a2e] px-3 py-3 shadow"
                >
                  <div className="text-xl sm:text-2xl font-bold text-white tabular-nums">
                    {String(unit.value).padStart(2, "0")}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-white/70">
                    {unit.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}