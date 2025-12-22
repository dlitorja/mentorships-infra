import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { InstructorCarousel } from "@/components/instructors/instructor-carousel";
import { TestimonialsCarousel } from "@/components/testimonials/testimonials-carousel";

export default function HomePage(): React.JSX.Element {
  return (
    <main className="min-h-screen textured-gradient text-foreground relative">
      <div className="relative z-10">
        {/* Hero */}
        <section className="relative flex min-h-[80vh] flex-col items-center justify-center px-4 py-20 text-center">
          <div className="mx-auto max-w-4xl w-full px-8 py-12 rounded-2xl bg-black/60 backdrop-blur-sm">
            <h1 className="text-5xl font-bold tracking-tight text-white sm:text-6xl md:text-7xl">
              Huckleberry Art Mentorships
            </h1>
            <p className="mt-6 text-xl text-white/90 sm:text-2xl">
              Personalized mentorship experiences with world-class instructors.
            </p>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
              Learn from industry professionals across gaming, TV, film, and independent art
              businesses.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Button asChild size="lg" className="text-lg vibrant-gradient-button transition-all">
                <Link href="/instructors">Browse Instructors</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="text-lg bg-white/10 text-white border-white/30 hover:bg-white/20">
                <Link href="#how-it-works">How it works</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Featured instructors */}
        <section id="instructors" className="py-20 px-4">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 text-center">
              <div className="inline-block px-8 py-6 rounded-2xl bg-black/60 backdrop-blur-sm">
                <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
                  Our Instructors
                </h2>
                <p className="mt-4 text-lg text-white/90">
                  Talented artists from gaming, TV, film, and independent studios.
                </p>
                <div className="mt-6">
                  <Button asChild size="lg" className="vibrant-gradient-button transition-all">
                    <Link href="/instructors">View All Instructors</Link>
                  </Button>
                </div>
              </div>
            </div>

            <InstructorCarousel />
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="py-20 px-4">
          <div className="mx-auto max-w-5xl">
            <div className="rounded-2xl bg-black/60 backdrop-blur-sm px-8 py-10 text-white">
              <h2 className="text-3xl font-bold sm:text-4xl">How it works</h2>
              <div className="mt-6 grid gap-6 md:grid-cols-3">
                <div className="rounded-xl bg-white/5 p-6">
                  <p className="text-sm font-semibold text-white/90">Step 1</p>
                  <h3 className="mt-2 text-xl font-semibold">Choose an instructor</h3>
                  <p className="mt-2 text-white/80">
                    Browse profiles, portfolios, and specialties to find your best fit.
                  </p>
                </div>
                <div className="rounded-xl bg-white/5 p-6">
                  <p className="text-sm font-semibold text-white/90">Step 2</p>
                  <h3 className="mt-2 text-xl font-semibold">Purchase on their offer page</h3>
                  <p className="mt-2 text-white/80">
                    When you're ready, complete your purchase on the instructor's offer page.
                  </p>
                </div>
                <div className="rounded-xl bg-white/5 p-6">
                  <p className="text-sm font-semibold text-white/90">Step 3</p>
                  <h3 className="mt-2 text-xl font-semibold">Start your mentorship</h3>
                  <p className="mt-2 text-white/80">
                    After your purchase is completed, you'll receive onboarding details in your email inbox to get started.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section id="testimonials" className="py-20 px-4">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 text-center">
              <div className="inline-block px-8 py-6 rounded-2xl bg-black/60 backdrop-blur-sm">
                <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
                  What students say
                </h2>
                <p className="mt-4 text-lg text-white/90">
                  Real feedback from students who have worked with our instructors
                </p>
              </div>
            </div>
            <TestimonialsCarousel />
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 px-4">
          <div className="mx-auto max-w-5xl text-center">
            <div className="rounded-2xl bg-black/60 backdrop-blur-sm px-8 py-12 text-white">
              <h2 className="text-3xl font-bold sm:text-4xl">Ready to get started?</h2>
              <p className="mt-4 text-white/80">
                Explore instructors and choose the mentorship that fits your goals.
              </p>
              <div className="mt-8">
                <Button asChild size="lg" className="vibrant-gradient-button transition-all">
                  <Link href="/instructors">Browse Instructors</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
