"use client";

import { use } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Twitter, Instagram, Youtube, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PortfolioGallery } from "@/components/instructors/portfolio-gallery";
import { usePublicInstructorBySlug } from "@/lib/queries/convex/use-instructors";
import { useProductsByMentorId } from "@/lib/queries/convex/use-products";
import { Id } from "@/convex/_generated/dataModel";

interface InstructorProfilePageProps {
  params: Promise<{ slug: string }>;
}

type SocialPlatform = {
  platform: string;
  url: string;
};

type Testimonial = {
  _id: string;
  name: string;
  text: string;
};

type MenteeResult = {
  _id: string;
  imageUrl?: string;
  studentName?: string;
};

type Product = {
  _id: string;
  title: string;
  price: string;
  sessionsPerPack: number;
  mentorshipType: string;
  active: boolean;
};

type Mentor = {
  _id: string;
  oneOnOneInventory: number;
  groupInventory: number;
};

type Instructor = {
  _id: string;
  name: string;
  slug: string;
  tagline?: string;
  bio?: string;
  specialties?: string[];
  background?: string[];
  profileImageUrl?: string;
  portfolioImages?: string[];
  socials?: SocialPlatform[];
  isActive: boolean;
  mentorId?: string;
};

type InstructorData = {
  instructor: Instructor;
  mentor: Mentor | null;
  testimonials: Testimonial[];
  menteeResults: MenteeResult[];
};

function SocialIcon({ platform }: { platform: string }) {
  switch (platform) {
    case "twitter":
      return <Twitter className="h-4 w-4" />;
    case "instagram":
      return <Instagram className="h-4 w-4" />;
    case "youtube":
      return <Youtube className="h-4 w-4" />;
    case "artstation":
    case "patreon":
    case "bluesky":
    case "website":
    default:
      return <ExternalLink className="h-4 w-4" />;
  }
}

function SocialLink({ url, platform }: { url: string; platform: string }) {
  const platformNames: Record<string, string> = {
    twitter: "Twitter",
    instagram: "Instagram",
    artstation: "ArtStation",
    website: "Website",
    youtube: "YouTube",
    patreon: "Patreon",
    bluesky: "Bluesky",
    facebook: "Facebook",
    behance: "Behance",
  };

  return (
    <Button
      asChild
      variant="default"
      size="lg"
      className="gap-2 shadow-md hover:shadow-lg transition-shadow"
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center"
      >
        <SocialIcon platform={platform} />
        {platformNames[platform] || platform}
      </a>
    </Button>
  );
}

function InstructorProfileContent({ slug }: { slug: string }) {
  const { data: instructorData, isLoading } = usePublicInstructorBySlug(slug);
  const data = instructorData as InstructorData | null;
  const instructor = data?.instructor;
  const mentor = data?.mentor;
  const testimonials = data?.testimonials || [];
  const menteeResults = data?.menteeResults || [];

  const mentorId = instructor?.mentorId as Id<"mentors"> | undefined;
  const { data: productsData } = useProductsByMentorId(mentorId!);
  const products = (productsData as Product[] || []).filter(p => p.active);

  const oneOnOneProduct = products.find(p => p.mentorshipType === "one-on-one");
  const groupProduct = products.find(p => p.mentorshipType === "group");

  const oneOnOneInventory = mentor?.oneOnOneInventory ?? 0;
  const groupInventory = mentor?.groupInventory ?? 0;

  const renderSpotsAvailable = (spots: number) => {
    if (spots === 0) {
      return (
        <p className="text-sm font-bold text-red-600 mt-1">
          SOLD OUT
        </p>
      );
    } else if (spots === 1) {
      return (
        <p className="text-sm font-bold text-red-600 mt-1">
          ONLY 1 SPOT LEFT
        </p>
      );
    } else if (spots === 2) {
      return (
        <p className="text-sm font-bold text-red-600 mt-1">
          ONLY 2 SPOTS LEFT
        </p>
      );
    } else {
      return (
        <p className="text-sm text-muted-foreground mt-1">
          {spots} spots available
        </p>
      );
    }
  };

  const socialLinks = instructor?.socials || [];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 md:py-12">
          <div className="mx-auto max-w-6xl">
            <div className="text-center py-20">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!instructor) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 md:py-12">
          <div className="mx-auto max-w-6xl">
            <div className="text-center py-20">
              <p className="text-muted-foreground">Coming soon</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 md:py-12">
        {/* Navigation removed - using Convex data */}

        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
            <div className="relative aspect-square w-full overflow-hidden rounded-lg">
              <Image
                src={instructor.profileImageUrl || "/placeholder.jpg"}
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
                <p className="mt-2 text-xl text-muted-foreground">
                  {instructor.tagline}
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-3">About</h2>
                <p className="text-muted-foreground leading-relaxed">
                  {instructor.bio}
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-3">Specialties</h2>
                <div className="flex flex-wrap gap-2">
                  {(instructor.specialties || []).map((specialty) => (
                    <Badge key={specialty} variant="secondary" className="text-sm">
                      {specialty}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-3">Background</h2>
                <div className="flex flex-wrap gap-2">
                  {(instructor.background || []).map((bg) => (
                    <Badge key={bg} variant="outline" className="text-sm">
                      {bg}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-3">Purchase</h2>
                <div className="space-y-4">
                  {oneOnOneProduct ? (
                    <div>
                      <p className="text-lg">
                        <span className="font-semibold">1-on-1 Mentorship:</span>{" "}
                        ${oneOnOneProduct.price} for {oneOnOneProduct.sessionsPerPack} sessions
                      </p>
                      {renderSpotsAvailable(oneOnOneInventory)}
                      <div className="mt-4">
                        {oneOnOneInventory === 0 ? (
                          <Button 
                            asChild 
                            size="lg" 
                            className="vibrant-gradient-button transition-all"
                          >
                            <Link href={`/waitlist?instructor=${instructor.slug}&type=one-on-one`}>
                              Sign up for waitlist
                            </Link>
                          </Button>
                        ) : (
                          <Button 
                            asChild 
                            size="lg" 
                            className="vibrant-gradient-button transition-all"
                          >
                            <Link href={`/checkout?instructor=${instructor.slug}&type=one-on-one`}>
                              Buy my 1-on-1 mentorship
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {groupProduct ? (
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-lg">
                        <span className="font-semibold">Group Mentorships:</span>{" "}
                        ${groupProduct.price} for {groupProduct.sessionsPerPack} sessions
                      </p>
                      {renderSpotsAvailable(groupInventory)}
                      <div className="mt-4">
                        {groupInventory === 0 ? (
                          <Button 
                            asChild 
                            size="lg" 
                            className="vibrant-gradient-button transition-all"
                          >
                            <Link href={`/waitlist?instructor=${instructor.slug}&type=group`}>
                              Sign up for waitlist
                            </Link>
                          </Button>
                        ) : (
                          <Button 
                            asChild 
                            size="lg" 
                            className="vibrant-gradient-button transition-all"
                          >
                            <Link href={`/checkout?instructor=${instructor.slug}&type=group`}>
                              Buy my group mentorship
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : !oneOnOneProduct ? (
                    <p className="text-muted-foreground">
                      No mentorship packages available at this time.
                    </p>
                  ) : null}
                </div>
              </div>

              {socialLinks.length > 0 && (
                <div>
                  <h2 className="text-2xl font-semibold mb-3">Socials</h2>
                  <div className="flex flex-wrap gap-2">
                    {socialLinks.map((social) => (
                      <SocialLink 
                        key={social.url} 
                        url={social.url} 
                        platform={social.platform} 
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {(instructor.portfolioImages || []).length > 0 && (
            <div className="mt-12">
              <div className="mb-6 flex items-center gap-3">
                <h2 className="text-3xl font-bold">Portfolio</h2>
                <p className="text-sm text-muted-foreground">
                  Click any image to view in full size
                </p>
              </div>
              <PortfolioGallery
                images={instructor.portfolioImages || []}
                instructorName={instructor.name}
              />
            </div>
          )}

          {testimonials.length > 0 && (
            <div className="mt-12">
              <h2 className="text-3xl font-bold mb-6">Testimonials</h2>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {testimonials.map((testimonial) => (
                  <div
                    key={testimonial._id}
                    className="rounded-lg border bg-card p-6 shadow-sm"
                  >
                    <Quote className="h-6 w-6 text-muted-foreground mb-4" />
                    <div className="text-base leading-relaxed mb-4 italic">
                      {testimonial.text}
                    </div>
                    <div>
                      <p className="font-semibold">{testimonial.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {menteeResults.length > 0 && (
            <div className="mt-12">
              <h2 className="text-3xl font-bold mb-6">Mentee Success Stories</h2>
              <PortfolioGallery
                images={menteeResults.map(r => r.imageUrl).filter(Boolean) as string[]}
                instructorName={instructor.name}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InstructorProfilePage({
  params,
}: InstructorProfilePageProps) {
  const { slug } = use(params);
  return <InstructorProfileContent slug={slug} />;
}

