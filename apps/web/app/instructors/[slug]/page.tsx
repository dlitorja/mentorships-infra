import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Twitter, Instagram, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PortfolioGallery } from "@/components/instructors/portfolio-gallery";
import { InstructorNavigation } from "@/components/instructors/instructor-navigation";
import { InstructorNavigationWrapper } from "@/components/instructors/instructor-navigation-wrapper";
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
  const groupSpots = instructor.pricing.group ? Math.floor(Math.random() * 5) + 1 : 0; // 1-5 spots for group
  
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
                        <span className="font-semibold">Group Mentorships:</span>{" "}
                        ${instructor.pricing.group} for 4 sessions
                      </p>
                      {renderSpotsAvailable(groupSpots)}
                      {instructor.slug === "rakasa" ? (
                        <div className="mt-2 mb-4 space-y-2">
                          <p className="text-sm text-muted-foreground">
                            This cohort of group mentorships meets on the following dates at 6:00 PM EST (11:00 PM UTC):
                          </p>
                          <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                            <li>January 6, 2025</li>
                            <li>January 13, 2025</li>
                            <li>January 20, 2025</li>
                            <li>January 27, 2025</li>
                          </ul>
                          <p className="text-sm text-muted-foreground mt-2">
                            Please only sign up if you can attend all 4 sessions on these dates and times.
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-2 mb-4">
                          Group mentorships happen at a fixed day of the week and time of day. Please only sign up if you can attend all 4 sessions at that scheduled day and time once the mentorship starts.
                        </p>
                      )}
                      {groupSpots === 0 ? (
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
                  )}
                </div>
              </div>

              {/* Social Links */}
              {Object.keys(socialLinks).length > 0 && (
                <div>
                  <h2 className="text-2xl font-semibold mb-3">Socials</h2>
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

        </div>
      </div>
      </div>
    </InstructorNavigation>
  );
}

