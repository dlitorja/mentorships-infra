import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Quote, Gift, Instagram, Youtube, Twitter, Globe } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PortfolioGallery } from "@/components/instructors/portfolio-gallery";
import { InstructorNavigation } from "@/components/instructors/instructor-navigation";
import { InstructorNavigationWrapper } from "@/components/instructors/instructor-navigation-wrapper";
import {
  getInstructorBySlug,
  getNextInstructor,
  getPreviousInstructor,
  instructors,
  type Testimonial,
} from "@/lib/instructors";
import { OffersSection } from "@/components/instructors/offers-section";

function getSocialIcon(platform: string): React.ReactElement {
  switch (platform.toLowerCase()) {
    case "instagram":
      return <Instagram className="h-5 w-5" />;
    case "youtube":
      return <Youtube className="h-5 w-5" />;
    case "twitter":
    case "x":
      return <Twitter className="h-5 w-5" />;
    default:
      return <Globe className="h-5 w-5" />;
  }
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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
    <InstructorNavigation>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 md:py-16">
          <InstructorNavigationWrapper
            currentSlug={slug}
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

              <div className="flex flex-col space-y-8">
                <div>
                  <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold uppercase tracking-wider text-white">
                    {instructor.name}
                  </h1>
                  <p className="mt-2 text-sm uppercase tracking-wide text-primary">{instructor.tagline}</p>
                </div>

                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">About</h2>
                  <p className="text-white/80 leading-relaxed">{instructor.bio}</p>
                </div>

                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Specialties</h2>
                  <div className="flex flex-wrap gap-2">
                    {instructor.specialties.map((specialty: string) => (
                      <span key={specialty} className="text-sm text-white/70 bg-white/5 px-3 py-1 rounded">
                        {specialty}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Background</h2>
                  <div className="flex flex-wrap gap-2">
                    {instructor.background.map((bg: string) => (
                      <span key={bg} className="text-sm text-white/70 border border-white/20 px-3 py-1 rounded">
                        {bg}
                      </span>
                    ))}
                  </div>
                </div>

                {instructor.socials && instructor.socials.length > 0 && (
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Socials</h2>
                    <div className="flex flex-wrap gap-3">
                      {instructor.socials
                        .filter(
                          (social) =>
                            typeof social.platform === "string" &&
                            typeof social.url === "string" &&
                            isValidUrl(social.url)
                        )
                        .map((social) => (
                          <Button
                            key={social.url}
                            asChild
                            size="sm"
                            className="flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 uppercase tracking-wide text-xs font-semibold"
                          >
                            <a
                              href={social.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`${social.platform} (opens in a new window)`}
                            >
                              {getSocialIcon(social.platform)}
                              {social.platform}
                            </a>
                          </Button>
                        ))}
                    </div>
                  </div>
                )}

                <OffersSection
                  offers={instructor.offers}
                  instructorSlug={instructor.slug}
                />

                {instructor.offersFreeMentorship && (
                  <div className="pt-8 border-t border-border">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Free Mentorship</h2>
                    <p className="text-white/70 mb-4 text-sm">
                      Sign up for a free mentorship session. Sessions may be recorded and uploaded to YouTube.
                    </p>
                    <Button
                      asChild
                      size="sm"
                      className="flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 uppercase tracking-wide text-xs font-semibold"
                    >
                      <Link href={`/free-mentorship?instructor=${instructor.slug}`}>
                        <Gift className="h-4 w-4" />
                        Sign Up for Free Session
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {instructor.workImages && instructor.workImages.length > 0 && (
              <div className="mt-16">
                <h2 className="text-2xl font-bold uppercase tracking-wider text-white mb-6">Portfolio</h2>
                <PortfolioGallery
                  images={instructor.workImages}
                  instructorName={instructor.name}
                />
              </div>
            )}

            {instructor.menteeBeforeAfterImages && instructor.menteeBeforeAfterImages.length > 0 && (
              <div className="mt-16">
                <h2 className="text-2xl font-bold uppercase tracking-wider text-white mb-6">Mentee Success Stories</h2>
                <PortfolioGallery
                  images={instructor.menteeBeforeAfterImages}
                  instructorName={instructor.name}
                />
              </div>
            )}

            {instructor.testimonials && instructor.testimonials.length > 0 && (
              <div className="mt-16">
                <h2 className="text-2xl font-bold uppercase tracking-wider text-white mb-8">Testimonials</h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {instructor.testimonials.map((testimonial: Testimonial, index: number) => (
                    <div
                      key={index}
                      className="rounded-lg bg-card p-6 border border-border"
                    >
                      <Quote className="h-5 w-5 text-primary mb-4" />
                      <div className="text-sm text-white/80 leading-relaxed mb-4">
                        {testimonial.text.split("\n\n").map((paragraph: string, pIndex: number, paragraphs: string[]) => (
                          <p key={pIndex} className={pIndex > 0 ? "mt-3" : ""}>
                            {pIndex === 0 && '"'}
                            {paragraph}
                            {pIndex === paragraphs.length - 1 && '"'}
                          </p>
                        ))}
                      </div>
                      <div className="border-t border-border pt-4">
                        <p className="font-semibold uppercase tracking-wide text-white text-xs">{testimonial.author}</p>
                        {testimonial.role && (
                          <p className="text-xs text-muted-foreground mt-1">
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
