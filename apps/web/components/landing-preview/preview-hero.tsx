"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";
import { motion } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut" },
  },
};

export function PreviewHero() {
  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center px-6 py-20 text-center bg-[#0f1117]">
      {/* Subtle radial gradient accent behind text */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(124, 58, 237, 0.08) 0%, transparent 70%)",
        }}
      />

      <motion.div
        className="relative z-10 mx-auto max-w-3xl space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.h1
          className="text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl lg:text-6xl"
          variants={itemVariants}
        >
          Learn from Industry Pros.
          <br />
          <span className="text-[#7c3aed]">Master Your Craft.</span>
        </motion.h1>

        <motion.p
          className="mx-auto max-w-2xl text-base text-[#a0a0b0] sm:text-lg md:text-xl leading-relaxed"
          variants={itemVariants}
        >
          1-on-1 mentorships with working professionals from gaming, TV, and
          film. Get personalized guidance to build the skills and portfolio you
          need.
        </motion.p>

        <motion.div
          className="flex flex-col gap-4 sm:flex-row sm:justify-center"
          variants={itemVariants}
        >
          <Button
            asChild
            size="lg"
            className="vibrant-gradient-button transition-all text-lg min-h-[44px]"
          >
            <Link href="#instructors">Browse Mentors</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-[#2a2d3e] bg-transparent text-white hover:bg-[#161822] hover:border-[#7c3aed]/50 text-lg min-h-[44px]"
          >
            <a href="https://home.huckleberry.art/store" target="_blank" rel="noopener noreferrer">
              View Courses
            </a>
          </Button>
        </motion.div>

        <motion.div className="pt-8" variants={itemVariants}>
          <a
            href="#instructors"
            className="inline-flex flex-col items-center gap-2 text-[#6b6b80] transition-colors hover:text-white"
            aria-label="Scroll to instructors"
          >
            <span className="text-sm">Explore</span>
            <ArrowDown className="h-5 w-5 animate-bounce" />
          </a>
        </motion.div>
      </motion.div>
    </section>
  );
}