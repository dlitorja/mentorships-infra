"use client";

import { useEffect, useState } from "react";
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
import { SALE, SALE_COURSES, saleBadge } from "./sale-data";

type Slide = {
  id: string;
  title: string;
  badge: string;
  ctaHref: string;
  bgImage: string;
};

const SLIDES: Slide[] = SALE_COURSES.map((course) => ({
  id: course.id,
  title: course.title,
  badge: saleBadge(course.percentOff),
  ctaHref: course.checkoutUrl,
  bgImage: course.carouselImage,
}));

export function PreviewHero() {
  const [api, setApi] = useState<CarouselApi>();

  useEffect(() => {
    if (!api) return;
    const id = setInterval(() => {
      if (api.canScrollNext()) api.scrollNext();
      else api.scrollTo(0);
    }, 6000);
    return () => clearInterval(id);
  }, [api]);

  return (
    <section className="relative min-h-[90svh] flex flex-col items-center justify-center bg-background">
      <div className="w-full max-w-6xl px-6 pt-8">
        <div className="text-center mb-6">
          <a
            href={SALE_COURSES[0].checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-base sm:text-lg font-semibold uppercase tracking-wider text-white bg-red-600 hover:bg-red-700 px-6 py-3 shadow-md"
          >
            {SALE.name}
          </a>
          <div className="mt-3 text-white/80 text-xs uppercase tracking-widest">
            {SALE.subheader}
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20">
        <Carousel setApi={setApi} opts={{ align: "start", loop: true }}>
          <CarouselContent>
            {SLIDES.map((slide) => (
              <CarouselItem key={slide.id}>
                <div className="relative min-h-[60svh] sm:min-h-[68svh] md:min-h-[72svh] flex items-center justify-center overflow-hidden">
                  <Image
                    src={slide.bgImage}
                    alt={slide.title}
                    fill
                    priority
                    className="object-contain"
                    sizes="100vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/20 to-transparent" />
                  <div className="relative z-10 mx-auto max-w-3xl text-center px-4">
                    <div className="mb-4">
                      <span className="inline-block bg-red-600 px-3 py-1 text-xs sm:text-sm font-semibold text-white shadow">
                        {slide.badge}
                      </span>
                    </div>
                    <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white leading-tight drop-shadow-[0_1px_4px_rgba(0,0,0,0.4)]">
                      {slide.title}
                    </h1>
                    <div className="mt-8 flex justify-center">
                      <Button
                        asChild
                        size="lg"
                        className="bg-white text-[#1a1a2e] hover:bg-white/95 min-h-[52px] px-10 text-base sm:text-lg font-semibold uppercase tracking-wide shadow-lg ring-1 ring-black/10"
                      >
                        <a
                          href={slide.ctaHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Learn More
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="absolute left-4 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full bg-white text-[#1a1a2e] shadow-lg hover:bg-white" />
          <CarouselNext className="absolute right-4 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full bg-white text-[#1a1a2e] shadow-lg hover:bg-white" />
        </Carousel>
      </div>
    </section>
  );
}
