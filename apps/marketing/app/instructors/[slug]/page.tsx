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
import { Instagram, Youtube, Twitter, Globe } from "lucide-react";
import {
  getInstructorBySlug,
  getNextInstructor,
  getPreviousInstructor,
  instructors,
  type Instructor,
  type InstructorOffer,
  type Testimonial,
} from "@/lib/instructors";

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
        <div className="container mx-auto px-4 py-8 md:py-12">
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
                    {instructor.specialties.map((specialty: string) => (
                      <Badge key={specialty} variant="secondary" className="text-sm">
                        {specialty}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-2xl font-semibold mb-3">Background</h2>
                  <div className="flex flex-wrap gap-2">
                    {instructor.background.map((bg: string) => (
                      <Badge key={bg} variant="outline" className="text-sm">
                        {bg}
                      </Badge>
                    ))}
                  </div>
                </div>

                {instructor.socials && instructor.socials.length > 0 && (
                  <div>
                    <h2 className="text-2xl font-semibold mb-4">Socials</h2>
                    <div className="flex flex-wrap gap-4">
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
                            className="flex items-center gap-3 px-6 py-3 text-base font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
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

                <div>
                  <h2 className="text-2xl font-semibold mb-3">Purchase</h2>
                  <p className="text-muted-foreground">
                    Purchases are handled on Kajabi. You'll be redirected to an external checkout.
                  </p>
                  
                  <div className="mt-4 space-y-4">
                    {instructor.offers
                      .filter((offer: InstructorOffer) => offer.active !== false)
                      .map((offer: InstructorOffer) => (
                        <Button
                          key={offer.kind}
                          asChild
                          size="lg"
                          className="vibrant-gradient-button transition-all gap-2"
                        >
                          <a href={offer.url} target="_blank" rel="noopener noreferrer">
                            {offer.label}
                          </a>
                        </Button>
                      ))}
                  </div>
                </div>
              </div>
            </div>

            {instructor.workImages && instructor.workImages.length > 0 && (
              <div className="mt-12">
                <h2 className="text-2xl font-semibold mb-3">Portfolio</h2>
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
                  {instructor.testimonials.map((testimonial: Testimonial, index: number) => (
                    <div
                      key={index}
                      className="rounded-lg border bg-card p-6 shadow-sm"
                    >
                      <Quote className="h-6 w-6 text-muted-foreground mb-4" />
                      <div className="text-base leading-relaxed mb-4 italic">
                        {testimonial.text.split("\n\n").map((paragraph: string, pIndex: number, paragraphs: string[]) => (
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