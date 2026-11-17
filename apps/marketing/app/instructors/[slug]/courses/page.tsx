import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CourseCard } from "@/components/portals/course-card";
import { BundleCard } from "@/components/portals/bundle-card";
import { BaseCard } from "@/components/portals/base-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, Gift } from "lucide-react";
import { getPortalBySlug, getAllPortals } from "@/config/instructor-portals";
import { HOLIDAY_SALE, getSaleDisplay } from "@/config/holiday-sale";

const NEIL_GRAY_MENTORSHIP_URL = "https://home.huckleberry.art/offers/ADNkiMXF/checkout";

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

  const salePrefix = HOLIDAY_SALE.isActive ? `${HOLIDAY_SALE.name} — ` : "";

  return {
    title: `${salePrefix}${portal.name} Courses | Huckleberry Art`,
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
  const showNeilGraySections = isNeilGrayPortal(slug);
  const showHolidaySale = HOLIDAY_SALE.isActive && [...bundles, ...courses].some((item) => item.sale);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="mx-auto max-w-2xl">
          {showHolidaySale && (
            <section className="mb-12 rounded-lg border border-red-200 bg-gradient-to-r from-orange-50 to-red-50 p-6 text-center dark:border-red-800 dark:from-orange-950 dark:to-red-950">
              <h1 className="text-2xl font-bold tracking-tight text-red-600 md:text-3xl dark:text-red-400">
                {HOLIDAY_SALE.name}
              </h1>
              <p className="mt-2 text-base font-medium text-foreground">
                {HOLIDAY_SALE.subheader}
              </p>
            </section>
          )}

          {showNeilGraySections && (
            <section className="mb-12">
              <h2 className="mb-6 text-3xl font-bold tracking-tight text-center md:text-left">
                1-on-1 Mentorship
              </h2>
              <BaseCard
                title="1-on-1 Mentorship with Neil Gray"
                description="Work directly with Neil Gray on your art. Personalized guidance tailored to your goals and skill level."
                url={NEIL_GRAY_MENTORSHIP_URL}
                buttonText="Buy 1-on-1 Mentorship"
                icon={<Briefcase className="h-5 w-5" />}
              />
            </section>
          )}

          {bundles.length > 0 && (
            <section className="mb-12">
              <h2 className="mb-6 text-3xl font-bold tracking-tight text-center md:text-left">
                <span className="text-indigo-600 dark:text-indigo-400">Save Money</span>{" "}
                — Get the courses together in a bundle
              </h2>
              <div className="grid gap-6">
                {bundles.map((bundle) => {
                  const sale = getSaleDisplay(bundle.sale);

                  return (
                    <BundleCard
                      // Titles are unique within a portal, so they are stable keys.
                      key={bundle.title}
                      title={bundle.title}
                      description={bundle.description}
                      url={bundle.url}
                      imageUrl={bundle.imageUrl}
                      buttonText={bundle.buttonText}
                      promoText={bundle.promoText}
                      saleBadge={sale?.badge}
                      price={sale?.salePrice}
                      regularPrice={sale?.regularPrice}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {courses.length > 0 && (
            <section>
              <h2 className="mb-6 text-3xl font-bold tracking-tight text-center md:text-left">
                Get the courses separately
              </h2>
              <div className="grid gap-6">
                {courses.map((course) => {
                  const sale = getSaleDisplay(course.sale);

                  return (
                    <CourseCard
                      key={course.title}
                      title={course.title}
                      description={course.description}
                      url={course.url}
                      imageUrl={course.imageUrl}
                      buttonText={course.buttonText}
                      promoText={course.promoText}
                      saleBadge={sale?.badge}
                      price={sale?.salePrice}
                      regularPrice={sale?.regularPrice}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {showNeilGraySections && (
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
