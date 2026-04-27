"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";

// Shared sale end date with other sale banners
const SALE_ENDS_AT = "2026-05-05T23:59:59.000Z";

type Slide = {
  id: string;
  title: string;
  badge: string;
  ctaHref: string;
  bgImage: string;
};

const SLIDES: Slide[] = [
  {
    id: "bundle",
    title:
      "Neil Gray’s Course Bundle — Character Design & Drawing Drapery & Clothing",
    badge: "67% OFF",
    ctaHref: "https://home.huckleberry.art/resource_redirect/offers/gkAXKN2g",
    bgImage: "/images/preview/sale-bundle.jpg",
  },
  {
    id: "drapery",
    title: "Drawing Drapery and Clothing with Neil Gray",
    badge: "54% OFF",
    ctaHref:
      "https://home.huckleberry.art/drawing-drapery-and-clothing-with-neil-gray",
    bgImage: "/images/preview/sale-new-course-1.jpg",
  },
  {
    id: "character-design",
    title: "Character Design with Neil Gray",
    badge: "58% OFF",
    ctaHref:
      "https://home.huckleberry.art/drawing-drapery-and-clothing-with-neil-gray",
    bgImage: "/images/preview/sale-new-course-2.jpg",
  },
];

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

function CountdownTimer({ endsAt }: { endsAt: string | null }) {
  const timeLeft = useCountdown(endsAt);
  if (!timeLeft) return null;
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

export function PreviewHero() {
  const [api, setApi] = useState<CarouselApi>();

  // Auto-advance slides every 6 seconds
  useEffect(() => {
    if (!api) return;
    const id = setInterval(() => {
      if (api.canScrollNext()) api.scrollNext();
      else api.scrollTo(0);
    }, 6000);
    return () => clearInterval(id);
  }, [api]);

  return (
    <section className="relative min-h-[90svh] flex items-center justify-center">
      {/* Shared Sale CTA + countdown above carousel */}
      <div className="absolute top-6 z-20 w-full px-6">
        <div className="mx-auto max-w-3xl text-center">
          <a
            href="https://home.huckleberry.art/resource_redirect/offers/gkAXKN2g"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-semibold uppercase tracking-wider text-white bg-[#7c3aed] hover:bg-[#6d28d9] px-4 py-2"
          >
            Neil Gray Courses Sale · Up to 67% Off
          </a>
          <div className="mt-3 flex justify-center">
            <CountdownTimer endsAt={SALE_ENDS_AT} />
          </div>
        </div>
      </div>

      <div className="absolute inset-0 z-0 bg-black/60" />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <Carousel setApi={setApi} opts={{ align: "start", loop: true }}>
          <CarouselContent>
            {SLIDES.map((slide) => (
              <CarouselItem key={slide.id}>
                <div className="relative min-h-[70svh] sm:min-h-[75svh] md:min-h-[80svh] flex items-center justify-center overflow-hidden">
                  <Image
                    src={slide.bgImage}
                    alt={slide.title}
                    fill
                    priority
                    className="object-cover"
                    sizes="100vw"
                  />
                  <div className="absolute inset-0 bg-black/50" />
                  <div className="relative z-10 mx-auto max-w-3xl text-center">
                    <div className="mb-4">
                      <span className="inline-block bg-[#7c3aed] px-3 py-1 text-xs font-semibold text-white">
                        {slide.badge}
                      </span>
                    </div>
                    <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white leading-tight">
                      {slide.title}
                    </h1>
                    <p className="mx-auto mt-4 max-w-xl text-white/90 sm:text-lg">
                      Learn from industry pros and develop meaningful work.
                    </p>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                      <Button
                        asChild
                        size="lg"
                        className="bg-white text-[#1a1a2e] hover:bg-white/90 min-h-[48px] px-8"
                      >
                        <a
                          href={slide.ctaHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Learn More
                        </a>
                      </Button>
                      <Button
                        asChild
                        size="lg"
                        variant="outline"
                        className="border-white text-white hover:bg-white/10 min-h-[48px] px-8"
                      >
                        <Link href="#instructors">Browse Mentors</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <div className="absolute inset-x-0 bottom-6 z-20 flex items-center justify-between px-6">
            <CarouselPrevious className="border-white text-white hover:bg-white/10" />
            <CarouselNext className="border-white text-white hover:bg-white/10" />
          </div>
        </Carousel>
      </div>
    </section>
  );
}
