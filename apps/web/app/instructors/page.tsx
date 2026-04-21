"use client";

import { useMemo, useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { usePublicInstructors } from "@/lib/queries/convex/use-instructors";

type PublicInstructor = {
  _id: string;
  name: string;
  slug: string;
  tagline?: string;
  profileImageUrl?: string;
  specialties?: string[];
  isNew?: boolean;
  isHidden?: boolean;
  mentor?: {
    oneOnOneInventory: number;
    groupInventory: number;
  };
};

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export default function InstructorsPage() {
  const { data: instructorsData, isLoading } = usePublicInstructors();
  const [instructors, setInstructors] = useState<any[]>([]);
  const [isClient, setIsClient] = useState(false);

  const delays = useMemo(() => {
    if (!isClient) {
      return instructors.map(() => 0);
    }
    return instructors.map((_, index) => index * 0.1);
  }, [instructors, isClient]);

  useEffect(() => {
    if (!instructorsData) return;
    
    const visible = instructorsData.filter((inst: any) => !inst.isHidden);
    const shuffled = isClient ? shuffleArray(visible) : visible;
    setInstructors(shuffled);
  }, [instructorsData, isClient]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-12">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 text-center">
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                Our Instructors
              </h1>
              <p className="mt-4 text-lg text-muted-foreground">
                Loading...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              Talented artists from gaming, TV, film, and some who are freelancers or indies
            </p>
          </div>

          {/* Instructors Grid */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {instructors.map((instructor, index) => (
              <motion.div
                key={instructor._id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.6,
                  delay: delays[index],
                  ease: "easeOut",
                }}
                className="h-full"
              >
                <Card className="flex flex-col h-full overflow-hidden transition-shadow hover:shadow-lg">
                  <Link 
                    href={`/instructors/${instructor.slug}`}
                    onClick={() => {
                      // Store the current random order in session storage for navigation
                      const order = instructors.map(inst => inst.slug);
                      sessionStorage.setItem('instructorOrder', JSON.stringify(order));
                    }}
                    className="relative aspect-[4/3] w-full overflow-hidden cursor-pointer flex-shrink-0"
                  >
                    <Image
                      key={`${instructor._id}-${instructor.profileImageUrl}`}
                      src={instructor.profileImageUrl || "/placeholder.jpg"}
                      alt={`${instructor.name} profile picture`}
                      fill
                      className="object-cover transition-transform hover:scale-105"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      priority={index < 6}
                    />
                    {instructor.isNew && (
                      <Badge
                        className="absolute top-4 left-4 bg-green-500 text-white px-3 py-1 rounded-full text-xs font-semibold"
                        aria-label="New instructor"
                      >
                        NEW
                      </Badge>
                    )}
                  </Link>
                  <CardContent className="flex flex-col flex-1 p-6">
                    <h3 className="text-xl font-semibold">{instructor.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {instructor.tagline}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {(instructor.specialties || []).slice(0, 3).map((specialty: string) => (
                        <Badge key={specialty} variant="secondary" className="text-xs">
                          {specialty}
                        </Badge>
                      ))}
                      {(instructor.specialties || []).length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{(instructor.specialties || []).length - 3} more
                        </Badge>
                      )}
                    </div>

                    <div className="mt-auto pt-6">
                      <Button asChild variant="outline" className="w-full">
                        <Link 
                          href={`/instructors/${instructor.slug}`}
                          onClick={() => {
                            // Store the current random order in session storage for navigation
                            const order = instructors.map(inst => inst.slug);
                            sessionStorage.setItem('instructorOrder', JSON.stringify(order));
                          }}
                        >
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
