import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink, Twitter, Instagram, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PortfolioGallery } from "@/components/instructors/portfolio-gallery";
import { InstructorNavigation } from "@/components/instructors/instructor-navigation";
import {
  getInstructorBySlug,
  getNextInstructor,
  getPreviousInstructor,
  getAvailableInstructors,
} from "@/lib/instructors";
import type { Instructor } from "@/lib/instructors";

interface InstructorProfilePageProps {
  params: Promise<{ slug: string }>;
}

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

export default async function InstructorProfilePage({
  params,
}: InstructorProfilePageProps) {
  const { slug } = await params;
  const instructor = getInstructorBySlug(slug);

  if (!instructor) {
    notFound();
  }

  const nextInstructor = getNextInstructor(slug);
  const previousInstructor = getPreviousInstructor(slug);
  const socialLinks = instructor.socialLinks || {};
  
  // Dummy data for available spots (will be replaced with real data later)
  const oneOnOneSpots = Math.floor(Math.random() * 6); // 0-5 spots
  const groupSpots = instructor.pricing.group ? Math.floor(Math.random() * 6) : 0;
  
  const renderSpotsAvailable = (spots: number) => {
    if (spots === 0) {
      return (
        <p className="text-sm font-bold text-red-600 mt-1">
          SOLD OUT - Please check later
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

  return (
    <InstructorNavigation
      previousSlug={previousInstructor?.slug || null}
      nextSlug={nextInstructor?.slug || null}
    >
      <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 md:py-12">
        {/* Navigation Header */}
        <div className="mb-8 flex items-center justify-between">
          <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow">
            <Link href="/instructors" className="flex items-center gap-2">
              ← View All Instructors
            </Link>
          </Button>
          
          <div className="flex items-center gap-3">
            {previousInstructor && (
              <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow min-w-[3rem]">
                <Link href={`/instructors/${previousInstructor.slug}`} className="flex items-center justify-center">
                  <ArrowLeft className="h-5 w-5" />
                  <span className="sr-only">Previous instructor</span>
                </Link>
              </Button>
            )}
            {nextInstructor && (
              <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow min-w-[3rem]">
                <Link href={`/instructors/${nextInstructor.slug}`} className="flex items-center justify-center">
                  <ArrowRight className="h-5 w-5" />
                  <span className="sr-only">Next instructor</span>
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
            {/* Profile Image */}
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

            {/* Profile Info */}
            <div className="flex flex-col space-y-6">
              <div>
                <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
                  {instructor.name}
                </h1>
                <p className="mt-2 text-xl text-muted-foreground">
                  {instructor.tagline}
                </p>
              </div>

              {/* Bio */}
              <div>
                <h2 className="text-2xl font-semibold mb-3">About</h2>
                <p className="text-muted-foreground leading-relaxed">
                  {instructor.bio}
                </p>
              </div>

              {/* Specialties */}
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

              {/* Background */}
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

              {/* Pricing */}
              <div>
                <h2 className="text-2xl font-semibold mb-3">Pricing</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-lg">
                      <span className="font-semibold">1-on-1 Mentorship:</span>{" "}
                      ${instructor.pricing.oneOnOne} for 4 sessions
                    </p>
                    {renderSpotsAvailable(oneOnOneSpots)}
                    <div className="mt-4">
                      {oneOnOneSpots === 0 ? (
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
                  {instructor.pricing.group && (
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-lg">
                        <span className="font-semibold">Group Sessions:</span>{" "}
                        ${instructor.pricing.group} for 4 sessions
                      </p>
                      {renderSpotsAvailable(groupSpots)}
                    </div>
                  )}
                </div>
              </div>

              {/* Social Links */}
              {Object.keys(socialLinks).length > 0 && (
                <div>
                  <h2 className="text-2xl font-semibold mb-3">Connect</h2>
                  <div className="flex flex-wrap gap-2">
                    {socialLinks.twitter && (
                      <SocialLink url={socialLinks.twitter} platform="twitter" />
                    )}
                    {socialLinks.instagram && (
                      <SocialLink url={socialLinks.instagram} platform="instagram" />
                    )}
                    {socialLinks.artstation && (
                      <SocialLink url={socialLinks.artstation} platform="artstation" />
                    )}
                    {socialLinks.website && (
                      <SocialLink url={socialLinks.website} platform="website" />
                    )}
                    {socialLinks.youtube && (
                      <SocialLink url={socialLinks.youtube} platform="youtube" />
                    )}
                    {socialLinks.patreon && (
                      <SocialLink url={socialLinks.patreon} platform="patreon" />
                    )}
                    {socialLinks.bluesky && (
                      <SocialLink url={socialLinks.bluesky} platform="bluesky" />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Portfolio Work */}
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

          {/* Navigation Footer */}
          <div className="mt-12 flex items-center justify-between border-t pt-8 gap-4">
            {previousInstructor ? (
              <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow">
                <Link href={`/instructors/${previousInstructor.slug}`} className="flex items-center gap-3">
                  <ArrowLeft className="h-5 w-5 shrink-0" />
                  <div className="font-semibold">{previousInstructor.name}</div>
                </Link>
              </Button>
            ) : (
              <div />
            )}

            <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow">
              <Link href="/instructors">View All Instructors</Link>
            </Button>

            {nextInstructor ? (
              <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow">
                <Link href={`/instructors/${nextInstructor.slug}`} className="flex items-center gap-3">
                  <div className="font-semibold">{nextInstructor.name}</div>
                  <ArrowRight className="h-5 w-5 shrink-0" />
                </Link>
              </Button>
            ) : (
              <div />
            )}
          </div>
        </div>
      </div>
      </div>
    </InstructorNavigation>
  );
}

