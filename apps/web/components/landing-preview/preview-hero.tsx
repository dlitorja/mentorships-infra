"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export function PreviewHero() {
  return (
    <section className="relative min-h-[100svh] flex items-center justify-center">
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/preview/sale-drawing-course.jpg"
          alt="Art by Huckleberry instructors"
          fill
          className="object-cover"
          priority
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-black/50" />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl leading-tight">
          Learn from Industry Pros.
          <br />
          Develop Meaningful Work.
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-lg text-white/90 sm:text-xl">
          Take your art to the next level with 1-on-1 mentorships from working professionals.
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Button
            asChild
            size="lg"
            className="bg-white text-[#1a1a2e] hover:bg-white/90 text-lg min-h-[48px] px-8"
          >
            <Link href="#instructors">Browse Mentors</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-white text-white hover:bg-white/10 text-lg min-h-[48px] px-8"
          >
            <a href="https://home.huckleberry.art/store" target="_blank" rel="noopener noreferrer">
              View Courses
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}