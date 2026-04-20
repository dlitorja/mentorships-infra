import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CourseCard } from "@/components/portals/course-card";
import { BundleCard } from "@/components/portals/bundle-card";
import { CountdownTimer } from "@/components/portals/countdown-timer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Gift } from "lucide-react";
import { getPortalBySlug, getAllPortals } from "@/config/instructor-portals";

const SALE_END_DATE = new Date("2026-05-05T00:00:00-07:00");

function isNeilGrayPortal(slug: string): boolean {
  return slug === "neil-gray";
}

interface InstructorCoursesPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): Array<{ slug: string }> {
  return getAllPortals().map((portal) => ({ slug: portal.slug }));
}

export async function generateMetadata({ params }: InstructorCoursesPageProps): Promise<Metadata> {
  const { slug } = await params;
  const portal = getPortalBySlug(slug);

  if (!portal) {
    return {
      title: "Instructor not found | Huckleberry Art",
    };
  }

  return {
    title: `${portal.name} Courses | Huckleberry Art`,
    description: `Browse courses by ${portal.name}. Get access to professional art instruction.`,
  };
}

export default async function InstructorCoursesPage({
  params,
}: InstructorCoursesPageProps): Promise<React.JSX.Element> {
  const { slug } = await params;
  const portal = getPortalBySlug(slug);

  if (!portal) {
    notFound();
  }

  const { bundles, courses } = portal;
  const showLaunchSale = isNeilGrayPortal(slug);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="mx-auto max-w-2xl">
          {showLaunchSale && (
            <CountdownTimer
              endDate={SALE_END_DATE}
              title="LAUNCH SALE - ENDS MAY 5TH"
            />
          )}

          {bundles.length > 0 && (
            <section className="mb-12">
              <h2 className="mb-6 text-3xl font-bold tracking-tight text-center md:text-left">
                <span className="text-indigo-600 dark:text-indigo-400">Save Money</span>{" "}
                — Get the courses together in a bundle
              </h2>
              <div className="grid gap-6">
                {bundles.map((bundle, index) => (
                  <BundleCard
                    key={index}
                    title={bundle.title}
                    description={bundle.description}
                    url={bundle.url}
                    imageUrl={bundle.imageUrl}
                    promoText={showLaunchSale ? bundle.promoText : undefined}
                  />
                ))}
              </div>
            </section>
          )}

          {courses.length > 0 && (
            <section>
              <h2 className="mb-6 text-3xl font-bold tracking-tight text-center md:text-left">
                Get the courses separately
              </h2>
              <div className="grid gap-6">
                {courses.map((course, index) => (
                  <CourseCard
                    key={index}
                    title={course.title}
                    description={course.description}
                    url={course.url}
                    imageUrl={course.imageUrl}
                    promoText={showLaunchSale ? course.promoText : undefined}
                    buttonText={course.buttonText}
                  />
                ))}
              </div>
            </section>
          )}

          {showLaunchSale && (
            <section className="mt-12">
              <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 to-indigo-500/5">
                <CardHeader className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Gift className="h-6 w-6 text-primary" />
                    <CardTitle className="text-2xl">Free Mentorship Session</CardTitle>
                  </div>
                  <CardDescription className="text-base">
                    Sign up to potentially be selected for a free one-on-one mentorship session with{" "}
                    {portal.name}. Sessions may be recorded for educational content.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button asChild size="lg" className="vibrant-gradient-button w-full text-lg font-semibold">
                    <Link href={`/free-mentorship?instructor=${slug}`}>
                      Sign Up for Free Mentorship
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}