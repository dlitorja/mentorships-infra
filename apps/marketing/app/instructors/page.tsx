import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getVisibleInstructors } from "@/lib/instructors";

// Force dynamic rendering to ensure random order on each page load
export const dynamic = "force-dynamic";

// Fisher-Yates shuffle algorithm to randomize array
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export default function InstructorsPage(): React.JSX.Element {
  // Get visible instructors and randomize their order on each page load
  const visibleInstructors = getVisibleInstructors();
  const randomizedInstructors = shuffleArray(visibleInstructors);

  // Deterministically select first 6 visible instructors alphabetically for priority loading
  // This ensures the same images are prioritized regardless of shuffle order
  const priorityInstructorIds = new Set(
    visibleInstructors
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 6)
      .map((inst) => inst.id)
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Our Instructors</h1>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {randomizedInstructors.map((instructor) => (
              <Card
                key={instructor.id}
                className="flex flex-col h-full overflow-hidden transition-shadow hover:shadow-lg"
              >
                <Link
                  href={`/instructors/${instructor.slug}`}
                  className="relative aspect-[4/3] w-full overflow-hidden cursor-pointer flex-shrink-0"
                >
<Image
                     src={instructor.profileImage}
                     alt={`${instructor.name} profile picture`}
                     fill
                     className="object-cover transition-transform hover:scale-105"
                     sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                     priority={priorityInstructorIds.has(instructor.id)}
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
                  <p className="mt-1 text-sm text-muted-foreground">{instructor.tagline}</p>

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
                      <Link href={`/instructors/${instructor.slug}`}>View Profile</Link>
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
