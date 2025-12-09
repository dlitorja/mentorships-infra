"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: "easeOut",
    },
  },
};

export function HeroSection(): JSX.Element {
  return (
    <section className="relative flex min-h-[90vh] flex-col items-center justify-center px-4 py-20 text-center">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="mx-auto max-w-4xl w-full px-8 py-12 rounded-2xl bg-black/60 backdrop-blur-sm">
          <motion.div
            className="space-y-8"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <motion.h1
              className="text-5xl font-bold tracking-tight text-white sm:text-6xl md:text-7xl"
              variants={itemVariants}
            >
              Huckleberry Art Mentorships
            </motion.h1>
            
            <motion.p
              className="text-xl text-white/90 sm:text-2xl"
              variants={itemVariants}
            >
              Connect with world-class instructors for personalized 1-on-1 and group mentorship experiences
            </motion.p>
            
            <motion.p
              className="mx-auto max-w-2xl text-lg leading-relaxed text-white/80"
              variants={itemVariants}
            >
              Learn from industry professionals across gaming, TV, film, and independent art businesses. 
              Whether you're looking for focused one-on-one guidance or collaborative group sessions, 
              our diverse roster of instructors brings real-world experience to help you achieve your artistic goals.
            </motion.p>
            
            <motion.div
              className="flex flex-col gap-4 sm:flex-row sm:justify-center"
              variants={itemVariants}
            >
              <Button asChild size="lg" className="text-lg vibrant-gradient-button transition-all">
                <Link href="/instructors">Browse Instructors</Link>
              </Button>
              <Button asChild size="lg" className="text-lg vibrant-gradient-button transition-all">
                <Link href="#find-match">Find Your Match</Link>
              </Button>
            </motion.div>
            
            <motion.div
              className="pt-8"
              variants={itemVariants}
            >
              <a
                href="#instructors"
                className="inline-flex flex-col items-center gap-2 text-white/70 transition-colors hover:text-white"
                aria-label="Scroll to instructors"
              >
                <span className="text-sm">Explore</span>
                <ArrowDown className="h-6 w-6 animate-bounce" />
              </a>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

