import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Quote } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PortfolioGallery } from "@/components/instructors/portfolio-gallery";
import { InstructorNavigation } from "@/components/instructors/instructor-navigation";
import { InstructorNavigationWrapper } from "@/components/instructors/instructor-navigation-wrapper";
import {
  getInstructorBySlug,
  getNextInstructor,
  getPreviousInstructor,
  instructors,
} from "@/lib/instructors";

interface InstructorProfilePageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): Array<{ slug: string }> {
  return instructors.map((instructor) => ({ slug: instructor.slug }));
}

export async function generateMetadata({
  params,
}: InstructorProfilePageProps): Promise<Metadata> {
  const { slug } = await params;
  const instructor = getInstructorBySlug(slug);

  if (!instructor) {
    return {
      title: "Instructor not found | Huckleberry Art Mentorships",
    };
  }

  return {
    title: `${instructor.name} | Huckleberry Art Mentorships`,
    description: instructor.tagline,
  };
}

export default async function InstructorProfilePage({
  params,
}: InstructorProfilePageProps): Promise<React.JSX.Element> {
  const { slug } = await params;
  const instructor = getInstructorBySlug(slug);

  if (!instructor) {
    notFound();
  }

  const nextInstructor = getNextInstructor(slug);
  const previousInstructor = getPreviousInstructor(slug);

  return (
    <InstructorNavigation
      previousSlug={previousInstructor?.slug || null}
      nextSlug={nextInstructor?.slug || null}
    >
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 md:py-12">
          <InstructorNavigationWrapper
            currentSlug={slug}
            instructor={instructor}
            defaultNext={nextInstructor}
            defaultPrevious={previousInstructor}
          />

          <div className="mx-auto max-w-6xl">

          <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
            <div className="relative aspect-square w-full overflow-hidden rounded-lg">
              <Image
                src={instructor.profileImage}
                alt={instructor.name}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 50vw"
                priority
              />
            </div>

            <div className="flex flex-col space-y-6">
              <div>
                <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
                  {instructor.name}
                </h1>
                <p className="mt-2 text-xl text-muted-foreground">{instructor.tagline}</p>
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-3">About</h2>
                <p className="text-muted-foreground leading-relaxed">{instructor.bio}</p>
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-3">Specialties</h2>
                <div className="flex flex-wrap gap-2">
                  {instructor.specialties.map((specialty) => (
                    <Badge key={specialty} variant="secondary" className="text-sm">
                      {specialty}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-3">Background</h2>
                <div className="flex flex-wrap gap-2">
                  {instructor.background.map((bg) => (
                    <Badge key={bg} variant="outline" className="text-sm">
                      {bg}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-3">Purchase</h2>
                <p className="text-muted-foreground">
                  Purchases are handled on Kajabi. You’ll be redirected to an external checkout.
                </p>

                <div className="mt-4 flex flex-col gap-3">
                  {instructor.offers
                    .filter((offer) => {
                      // Hide inactive offers (e.g., placeholder URLs)
                      if (offer.active === false) {
                        return false;
                      }
                      // Default to showing offer if active is not specified (backward compatibility)
                      return true;
                    })
                    .map((offer) => (
                      <Button
                        key={offer.kind}
                        asChild
                        size="lg"
                        className="vibrant-gradient-button transition-all gap-2"
                      >
                        <a href={offer.url} target="_blank" rel="noopener noreferrer">
                          {offer.label}
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    ))}
                </div>
              </div>
            </div>
          </div>

          {instructor.workImages.length > 0 && (
            <div className="mt-12">
              <div className="mb-6 flex items-center gap-3">
                <h2 className="text-3xl font-bold">Portfolio</h2>
                <p className="text-sm text-muted-foreground">
                  Click any image to view in full size
                </p>
              </div>
              <PortfolioGallery
                images={instructor.workImages}
                instructorName={instructor.name}
              />
            </div>
          )}

          {instructor.testimonials && instructor.testimonials.length > 0 && (
            <div className="mt-12">
              <h2 className="text-3xl font-bold mb-6">Testimonials</h2>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {instructor.testimonials.map((testimonial, index) => (
                  <div
                    key={index}
                    className="rounded-lg border bg-card p-6 shadow-sm"
                  >
                    <Quote className="h-6 w-6 text-muted-foreground mb-4" />
                    <div className="text-base leading-relaxed mb-4 italic">
                      {testimonial.text.split("\n\n").map((paragraph, pIndex, paragraphs) => (
                        <p key={pIndex} className={pIndex > 0 ? "mt-4" : ""}>
                          {pIndex === 0 && '"'}
                          {paragraph}
                          {pIndex === paragraphs.length - 1 && '"'}
                        </p>
                      ))}
                    </div>
                    <div>
                      <p className="font-semibold">{testimonial.author}</p>
                      {testimonial.role && (
                        <p className="text-sm text-muted-foreground">
                          {testimonial.role}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </InstructorNavigation>
  );
}
