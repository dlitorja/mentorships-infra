"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePublicInstructors } from "@/lib/queries/convex/use-instructors";

export default function InstructorsPage(): React.JSX.Element {
  const { data, isLoading } = usePublicInstructors();
  const [instructors, setInstructors] = useState<any[]>([]);

  // Randomize on client to match marketing exposure pattern
  const randomized = useMemo(() => {
    const visible = (data || []).filter((i: any) => !i.isHidden);
    const copy = [...visible];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }, [data]);

  useEffect(() => {
    setInstructors(randomized);
  }, [randomized]);

  // Deterministic priority list for image preloading (first 6 alphabetically)
  const priorityIds = useMemo(() => {
    const sorted = (data || [])
      .filter((i: any) => !i.isHidden)
      .slice()
      .sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""))
      .slice(0, 6)
      .map((i: any) => i._id);
    return new Set(sorted);
  }, [data]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-12">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 text-center">
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Our Instructors</h1>
              <p className="mt-4 text-lg text-muted-foreground">Loading...</p>
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
          <div className="mb-12 text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Our Instructors</h1>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {instructors.map((instructor: any) => (
              <Card key={instructor._id} className="flex flex-col h-full overflow-hidden transition-shadow hover:shadow-lg">
                <Link
                  href={`/instructors/${instructor.slug}`}
                  className="relative aspect-[4/3] w-full overflow-hidden cursor-pointer flex-shrink-0"
                  onClick={() => {
                    const order = instructors.map((inst: any) => inst.slug);
                    sessionStorage.setItem("instructorOrder", JSON.stringify(order));
                  }}
                >
                  <Image
                    src={instructor.profileImageUrl || "/placeholder.jpg"}
                    alt={`${instructor.name} profile picture`}
                    fill
                    className="object-cover transition-transform hover:scale-105"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    priority={priorityIds.has(instructor._id)}
                  />
                  {instructor.isNew && (
                    <Badge className="absolute top-4 left-4 bg-green-500 text-white px-3 py-1 rounded-full text-xs font-semibold" aria-label="New instructor">
                      NEW
                    </Badge>
                  )}
                </Link>
                <CardContent className="flex flex-col flex-1 p-6">
                  <h3 className="text-xl font-semibold">{instructor.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{instructor.tagline}</p>

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
                          const order = instructors.map((inst: any) => inst.slug);
                          sessionStorage.setItem("instructorOrder", JSON.stringify(order));
                        }}
                      >
                        View Profile
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
