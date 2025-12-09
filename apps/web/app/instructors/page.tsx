"use client";

import { useMemo, useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getAvailableInstructors, mockInstructors } from "@/lib/instructors";

export default function InstructorsPage() {
  // Use deterministic order for SSR, then shuffle on client to avoid hydration mismatch
  const [instructors, setInstructors] = useState(mockInstructors);
  const [isClient, setIsClient] = useState(false);

  // Generate ordered delays for each instructor based on index
  // Only generate on client side to avoid hydration mismatch
  const delays = useMemo(() => {
    if (!isClient) {
      // Return zero delays during SSR to avoid mismatch
      return instructors.map(() => 0);
    }
    return instructors.map((_, index) => index * 0.1);
  }, [instructors, isClient]);

  useEffect(() => {
    // Only shuffle on client side after mount to avoid hydration mismatch
    setIsClient(true);
    setInstructors(getAvailableInstructors());
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="mb-12 text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Our Instructors
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Discover talented artists from gaming, TV, film, and independent studios
            </p>
          </div>

          {/* Instructors Grid */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {instructors.map((instructor, index) => (
              <motion.div
                key={instructor.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.6,
                  delay: delays[index],
                  ease: "easeOut",
                }}
              >
                <Card className="flex flex-col overflow-hidden transition-shadow hover:shadow-lg">
                  <Link href={`/instructors/${instructor.slug}`} className="relative aspect-[4/3] w-full overflow-hidden cursor-pointer">
                    <Image
                      src={instructor.profileImage}
                      alt={instructor.name}
                      fill
                      className="object-cover transition-transform hover:scale-105"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    />
                  </Link>
                  <CardContent className="flex flex-col flex-1 p-6">
                    <h3 className="text-xl font-semibold">{instructor.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {instructor.tagline}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {instructor.specialties.slice(0, 3).map((specialty) => (
                        <Badge key={specialty} variant="secondary" className="text-xs">
                          {specialty}
                        </Badge>
                      ))}
                      {instructor.specialties.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{instructor.specialties.length - 3} more
                        </Badge>
                      )}
                    </div>

                    <div className="mt-auto pt-6">
                      <Button asChild variant="outline" className="w-full">
                        <Link href={`/instructors/${instructor.slug}`}>
                          View Profile
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Footer CTA */}
          <div className="mt-12 text-center">
            <p className="text-muted-foreground mb-4">
              Interested in becoming an instructor?
            </p>
            <Button asChild variant="outline">
              <Link href="/">Contact Us</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

