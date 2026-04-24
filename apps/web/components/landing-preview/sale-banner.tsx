"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";

interface SaleItem {
  id: string;
  title: string;
  badge: string;
  description: string;
  endsAt: string | null;
  image: string;
  link: string;
}

const SALE_ITEMS: SaleItem[] = [
  {
    id: "bundle",
    title: "COURSE_NAME_HERE",
    badge: "67% OFF",
    description: "BUNDLE_DESCRIPTION_HERE",
    endsAt: "END_DATE_HERE",
    image: "/images/preview/sale-bundle.jpg",
    link: "https://home.huckleberry.art/resource_redirect/offers/gkAXKN2g",
  },
  {
    id: "new-course-1",
    title: "COURSE_NAME_HERE",
    badge: "54% OFF",
    description: "COURSE_DESCRIPTION_HERE",
    endsAt: "END_DATE_HERE",
    image: "/images/preview/sale-new-course-1.jpg",
    link: "https://home.huckleberry.art/resource_redirect/landing_pages/2151951362",
  },
  {
    id: "new-course-2",
    title: "COURSE_NAME_HERE",
    badge: "58% OFF",
    description: "COURSE_DESCRIPTION_HERE",
    endsAt: "END_DATE_HERE",
    image: "/images/preview/sale-new-course-2.jpg",
    link: "https://home.huckleberry.art/resource_redirect/landing_pages/2151610810",
  },
  {
    id: "mentor-kim",
    title: "New Mentor \u2014 Kim Myatt",
    badge: "1-ON-1 MENTORSHIPS",
    description: "1-on-1 mentorships available",
    endsAt: null,
    image: "/images/preview/mentor-kim-myatt.jpg",
    link: "https://mentorships.huckleberry.art",
  },
  {
    id: "drawing-course",
    title: "COURSE_NAME_HERE",
    badge: "NEW",
    description: "COURSE_DESCRIPTION_HERE",
    endsAt: "END_DATE_HERE",
    image: "/images/preview/sale-drawing-course.jpg",
    link: "https://home.huckleberry.art/resource_redirect/landing_pages/2150836416",
  },
];

function useCountdown(targetDate: string | null) {
  const calculate = useCallback(() => {
    if (!targetDate || targetDate === "END_DATE_HERE") return null;
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

    const interval = setInterval(() => {
      setTimeLeft(calculate());
    }, 1000);

    return () => clearInterval(interval);
  }, [calculate]);

  return timeLeft;
}

function CountdownTimer({ endsAt }: { endsAt: string | null }) {
  const timeLeft = useCountdown(endsAt);

  if (!timeLeft) {
    return (
      <span className="text-sm font-semibold text-[#7c3aed]">
        Enroll Now
      </span>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      {[
        { value: timeLeft.days, label: "Days" },
        { value: timeLeft.hours, label: "Hrs" },
        { value: timeLeft.minutes, label: "Min" },
        { value: timeLeft.seconds, label: "Sec" },
      ].map((unit) => (
        <div key={unit.label} className="rounded bg-[#0f1117] px-2 py-2">
          <div className="text-lg sm:text-xl font-bold text-white tabular-nums">
            {String(unit.value).padStart(2, "0")}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[#6b6b80]">
            {unit.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SaleBanner() {
  return (
    <section className="bg-[#161822] py-20 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Special Offers
          </h2>
          <p className="mt-4 text-[#a0a0b0]">
            Limited time deals on courses and mentorships
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SALE_ITEMS.map((item) => (
            <a
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group overflow-hidden rounded-lg border border-[#2a2d3e] bg-[#0f1117] transition-colors hover:border-[#7c3aed]/50"
            >
              <div className="relative aspect-square w-full overflow-hidden">
                <Image
                  src={item.image}
                  alt={item.title}
                  fill
                  className="object-cover transition-transform group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
                <div className="absolute top-3 left-3">
                  <span className="inline-block rounded-full bg-[#7c3aed] px-3 py-1 text-xs font-semibold text-white">
                    {item.badge}
                  </span>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <h3 className="text-base font-semibold text-white group-hover:text-[#7c3aed] transition-colors line-clamp-2">
                  {item.title}
                </h3>
                {item.description !== "COURSE_DESCRIPTION_HERE" &&
                  item.description !== "BUNDLE_DESCRIPTION_HERE" && (
                    <p className="text-sm text-[#a0a0b0] line-clamp-2">
                      {item.description}
                    </p>
                  )}
                <CountdownTimer endsAt={item.endsAt} />
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}