"use client";

import { use } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Twitter, Instagram, Youtube, Quote, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PortfolioGallery } from "@/components/instructors/portfolio-gallery";
import { usePublicInstructorBySlug } from "@/lib/queries/convex/use-instructors";
import { useProductsByInstructorId } from "@/lib/queries/convex/use-products";
import { getInstructorBySlug, type Instructor as MockInstructor, type Testimonial as MockTestimonial } from "@/lib/instructors";
import { Id } from "@/convex/_generated/dataModel";
import { InstructorNavigation } from "@/components/instructors/instructor-navigation";
import { InstructorNavigationWrapper } from "@/components/instructors/instructor-navigation-wrapper";

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
  const instructorProfile = data?.mentor;
  const convexTestimonials = data?.testimonials || [];
  const menteeResults = data?.menteeResults || [];

  const mockInstructor = getInstructorBySlug(slug);
  const useMockData = !instructor && mockInstructor;
  const displayInstructor = instructor || (mockInstructor ? {
    _id: 'mock',
    name: mockInstructor.name,
    slug: mockInstructor.slug,
    tagline: mockInstructor.tagline,
    bio: mockInstructor.bio,
    specialties: mockInstructor.specialties,
    background: mockInstructor.background,
    profileImageUrl: mockInstructor.profileImage,
    portfolioImages: mockInstructor.workImages,
    socials: mockInstructor.socialLinks ? Object.entries(mockInstructor.socialLinks).map(([platform, url]) => ({ platform, url })) : [],
    isActive: true,
  } : null);

  const displayTestimonials = convexTestimonials.length > 0 ? convexTestimonials : (mockInstructor?.testimonials?.map((t, i) => ({
    _id: `mock-${i}`,
    name: t.author,
    text: t.text,
  })) || []);

  const instructorId = displayInstructor?.mentorId as Id<"instructors"> | undefined;
  const { data: productsData } = useProductsByInstructorId(instructorId!);
  const products = (productsData as Product[] || []).filter(p => p.active);

  const oneOnOneProduct = products.find(p => p.mentorshipType === "one-on-one");
  const groupProduct = products.find(p => p.mentorshipType === "group");

  const oneOnOneInventory = instructorProfile?.oneOnOneInventory ?? 0;
  const groupInventory = instructorProfile?.groupInventory ?? 0;

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

  const socialLinks = displayInstructor?.socials || [];

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

  if (!displayInstructor) {
    notFound();
  }

  return (
    <InstructorNavigation>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 md:py-12">
          <div className="mx-auto max-w-6xl">
            <InstructorNavigationWrapper currentSlug={displayInstructor.slug} />

            <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
              <div className="relative aspect-square w-full overflow-hidden rounded-lg">
                <Image
                  src={displayInstructor.profileImageUrl || "/placeholder.jpg"}
                  alt={displayInstructor.name}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 50vw"
                  priority
                />
              </div>

              <div className="flex flex-col space-y-6">
                <div>
                  <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{displayInstructor.name}</h1>
                  <p className="mt-2 text-xl text-muted-foreground">{displayInstructor.tagline}</p>
                </div>

                <div>
                  <h2 className="text-2xl font-semibold mb-3">About</h2>
                  <p className="text-muted-foreground leading-relaxed">{displayInstructor.bio}</p>
                </div>

                <div>
                  <h2 className="text-2xl font-semibold mb-3">Specialties</h2>
                  <div className="flex flex-wrap gap-2">
                    {(displayInstructor.specialties || []).map((specialty) => (
                      <Badge key={specialty} variant="secondary" className="text-sm">
                        {specialty}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-2xl font-semibold mb-3">Background</h2>
                  <div className="flex flex-wrap gap-2">
                    {(displayInstructor.background || []).map((bg) => (
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
                            <Button asChild size="lg" className="vibrant-gradient-button transition-all">
                              <Link href={`/waitlist?instructor=${displayInstructor.slug}&type=one-on-one`}>Sign up for waitlist</Link>
                            </Button>
                          ) : (
                            <Button asChild size="lg" className="vibrant-gradient-button transition-all">
                              <Link href={`/checkout?instructor=${displayInstructor.slug}&type=one-on-one`}>Buy my 1-on-1 mentorship</Link>
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
                            <Button asChild size="lg" className="vibrant-gradient-button transition-all">
                              <Link href={`/waitlist?instructor=${displayInstructor.slug}&type=group`}>Sign up for waitlist</Link>
                            </Button>
                          ) : (
                            <Button asChild size="lg" className="vibrant-gradient-button transition-all">
                              <Link href={`/checkout?instructor=${displayInstructor.slug}&type=group`}>Buy my group mentorship</Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : !oneOnOneProduct ? (
                      <p className="text-muted-foreground">No mentorship packages available at this time.</p>
                    ) : null}
                  </div>
                </div>

{socialLinks.length > 0 && (
                  <div>
                    <h2 className="text-2xl font-semibold mb-3">Socials</h2>
                    <div className="flex flex-wrap gap-2">
                      {socialLinks.map((social) => (
                        <SocialLink key={social.url} url={social.url} platform={social.platform} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {(displayInstructor.portfolioImages || []).length > 0 && (
              <div className="mt-12">
                <div className="mb-6 flex items-center gap-3">
                  <h2 className="text-3xl font-bold">Portfolio</h2>
                  <p className="text-sm text-muted-foreground">Click any image to view in full size</p>
                </div>
                <PortfolioGallery images={displayInstructor.portfolioImages || []} instructorName={displayInstructor.name} />
              </div>
            )}

            {displayTestimonials.length > 0 && (
              <div className="mt-12">
                <h2 className="text-3xl font-bold mb-6">Testimonials</h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {displayTestimonials.map((testimonial) => (
                    <div key={testimonial._id} className="rounded-lg border bg-card p-6 shadow-sm">
                      <Quote className="h-6 w-6 text-muted-foreground mb-4" />
                      <div className="text-base leading-relaxed mb-4 italic">{testimonial.text}</div>
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
                <PortfolioGallery images={menteeResults.map((r) => r.imageUrl).filter(Boolean) as string[]} instructorName={displayInstructor.name} />
              </div>
            )}
          </div>
        </div>
      </div>
    </InstructorNavigation>
  );
}

export default function InstructorProfilePage({
  params,
}: InstructorProfilePageProps) {
  const { slug } = use(params);
  return <InstructorProfileContent slug={slug} />;
}
