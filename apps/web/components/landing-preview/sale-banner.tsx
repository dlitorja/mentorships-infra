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
    title: "Special Course Bundle",
    badge: "67% OFF",
    description: "Get both courses for $120 · Limited time",
    endsAt: null, // No explicit countdown on the source page
    image: "/images/preview/sale-bundle.jpg",
    link: "https://home.huckleberry.art/resource_redirect/offers/gkAXKN2g",
  },
  {
    id: "new-course-1",
    title: "New Course · 54% OFF",
    badge: "SALE",
    description: "Sale ends May 5th",
    endsAt: "2026-05-05T23:59:59.000Z",
    image: "/images/preview/sale-new-course-1.jpg",
    link: "https://home.huckleberry.art/resource_redirect/landing_pages/2151951362",
  },
  {
    id: "new-course-2",
    title: "Featured Course · 58% OFF",
    badge: "SALE",
    description: "Sale ends May 5th",
    endsAt: "2026-05-05T23:59:59.000Z",
    image: "/images/preview/sale-new-course-2.jpg",
    link: "https://home.huckleberry.art/resource_redirect/landing_pages/2151610810",
  },
  // Keep mentorship item ready if we want to rotate; excluded from the 3-card cap
  {
    id: "mentor-kim",
    title: "New Mentor — Kim Myatt",
    badge: "MENTORSHIPS",
    description: "1-on-1 mentorships available",
    endsAt: null,
    image: "/images/preview/mentor-kim-myatt.jpg",
    link: "https://mentorships.huckleberry.art",
  },
  {
    id: "drawing-course",
    title: "Drawing from Imagination",
    badge: "NEW",
    description: "Start learning today",
    endsAt: null,
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
        <div key={unit.label} className="rounded bg-[#1a1a2e] px-2 py-2">
          <div className="text-lg sm:text-xl font-bold text-white tabular-nums">
            {String(unit.value).padStart(2, "0")}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-white/60">
            {unit.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SaleBanner() {
  // Use the first three curated items to mirror Underpaint's 3-card layout
  const liveItems = SALE_ITEMS.slice(0, 3);

  return (
    <section className="bg-white py-20 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
            Courses on Sale
          </h2>
        </div>
        {/* Single shared countdown under the section heading */}
        <div className="mb-10 flex justify-center">
          <CountdownTimer endsAt="2026-05-05T23:59:59.000Z" />
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {liveItems.map((item) => (
            <a
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group block overflow-hidden bg-white border border-gray-200 hover:border-[#7c3aed]/50 transition-colors"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-white">
                <Image
                  src={item.image}
                  alt={item.title !== "COURSE_NAME_HERE" ? item.title : "Course offering"}
                  fill
                  className="object-contain transition-transform group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
                <div className="absolute top-3 left-3">
                  <span className="inline-block bg-[#dc2626] px-3 py-1 text-xs sm:text-sm font-semibold text-white shadow">
                    {item.badge}
                  </span>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <h3 className="text-base font-semibold text-[#1a1a2e] group-hover:text-[#7c3aed] transition-colors line-clamp-2">
                  {item.title}
                </h3>
                {item.description && (
                  <p className="text-sm text-gray-500 line-clamp-2">
                    {item.description}
                  </p>
                )}
              </div>
            </a>
          ))}
        </div>

        <div className="mt-10 text-center">
          <a
            href="https://home.huckleberry.art/store"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-[#7c3aed] hover:text-[#6d28d9] font-semibold text-sm uppercase tracking-wider"
          >
            See All Courses &rarr;
          </a>
        </div>
      </div>
    </section>
  );
}
