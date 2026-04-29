import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      <div className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-7xl">
          <h1 className="section-title mb-16 text-white">Our Instructors</h1>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {randomizedInstructors.map((instructor) => (
              <div key={instructor.id} className="group">
                <Link
                  href={`/instructors/${instructor.slug}`}
                  className="relative aspect-[4/3] w-full overflow-hidden cursor-pointer block rounded-lg"
                >
                  <Image
                    src={instructor.profileImage}
                    alt={`${instructor.name} profile picture`}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    priority={priorityInstructorIds.has(instructor.id)}
                  />
                  {instructor.isNew && (
                    <Badge
                      className="absolute top-4 left-4 bg-primary text-primary-foreground px-3 py-1 rounded text-xs font-semibold uppercase tracking-wide"
                      aria-label="New instructor"
                    >
                      NEW
                    </Badge>
                  )}
                </Link>

                <div className="mt-4">
                  <h3 className="text-xl font-bold uppercase tracking-wider text-white">{instructor.name}</h3>
                  <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{instructor.tagline}</p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {instructor.specialties.slice(0, 3).map((specialty) => (
                      <span key={specialty} className="text-xs text-muted-foreground">
                        {specialty}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4">
                    <Button asChild variant="outline" size="sm" className="border-white/30 text-white hover:bg-white/10 uppercase tracking-wide text-xs font-semibold">
                      <Link href={`/instructors/${instructor.slug}`}>View Bio</Link>
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
