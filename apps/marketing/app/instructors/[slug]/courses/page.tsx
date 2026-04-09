import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CourseCard } from "@/components/portals/course-card";
import { BundleCard } from "@/components/portals/bundle-card";
import { getPortalBySlug, getAllPortals } from "@/config/instructor-portals";

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

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="mx-auto max-w-6xl">
          {bundles.length > 0 && (
            <section className="mb-12">
              <h2 className="mb-6 text-2xl font-bold tracking-tight">Bundles</h2>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {bundles.map((bundle, index) => (
                  <BundleCard
                    key={index}
                    title={bundle.title}
                    description={bundle.description}
                    url={bundle.url}
                    imageUrl={bundle.imageUrl}
                  />
                ))}
              </div>
            </section>
          )}

          {courses.length > 0 && (
            <section>
              <h2 className="mb-6 text-2xl font-bold tracking-tight">Individual Courses</h2>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {courses.map((course, index) => (
                  <CourseCard
                    key={index}
                    title={course.title}
                    description={course.description}
                    url={course.url}
                    imageUrl={course.imageUrl}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}