import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { InstructorCarousel } from "@/components/instructors/instructor-carousel";
import { TestimonialsCarousel } from "@/components/testimonials/testimonials-carousel";

export default function HomePage(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hero Section with Logo */}
      <section className="py-16 md:py-24 px-4">
        <div className="mx-auto max-w-7xl text-center">
          <div className="mb-8 flex justify-center">
            <div className="relative h-24 md:h-32 w-auto" style={{ width: '228px' }}>
              <Image
                src="/logo_bad2.png"
                alt="Huckleberry Art"
                fill
                style={{ objectFit: 'contain' }}
                className="brightness-0 invert"
                priority
              />
            </div>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold tracking-wide uppercase">
              <Link href="/instructors">View All Instructors</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 font-semibold tracking-wide uppercase">
              <Link href="#how-it-works">How It Works</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Featured Instructors */}
      <section id="instructors" className="py-16 md:py-20 px-4">
        <div className="mx-auto max-w-7xl">
          <h2 className="section-title mb-12 text-white">Our Instructors</h2>
          <ErrorBoundary fallback={<p className="text-muted-foreground text-center">Unable to load instructors.</p>}>
            <InstructorCarousel />
          </ErrorBoundary>
          <div className="mt-12 text-center">
            <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold tracking-wide uppercase">
              <Link href="/instructors">See All Instructors</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="py-16 md:py-20 px-4 bg-card">
        <div className="mx-auto max-w-5xl">
          <h2 className="section-title mb-12 text-white">How It Works</h2>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="text-center p-6">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">1</span>
              </div>
              <h3 className="text-xl font-semibold uppercase tracking-wide mb-3 text-white">Choose an Instructor</h3>
              <p className="text-muted-foreground leading-relaxed">
                Browse profiles, portfolios, and specialties to find your best fit.
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">2</span>
              </div>
              <h3 className="text-xl font-semibold uppercase tracking-wide mb-3 text-white">Purchase a Package</h3>
              <p className="text-muted-foreground leading-relaxed">
                When you&apos;re ready, complete your purchase on the instructor&apos;s offer page.
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">3</span>
              </div>
              <h3 className="text-xl font-semibold uppercase tracking-wide mb-3 text-white">Start Your Mentorship</h3>
              <p className="text-muted-foreground leading-relaxed">
                After your purchase is completed, you&apos;ll receive onboarding details in your email inbox to get started.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-16 md:py-20 px-4">
        <div className="mx-auto max-w-7xl">
          <h2 className="section-title mb-4 text-white">What Students Say</h2>
          <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
            Real feedback from students who have worked with our instructors
          </p>
          <ErrorBoundary fallback={<p className="text-muted-foreground text-center">Unable to load testimonials.</p>}>
            <TestimonialsCarousel />
          </ErrorBoundary>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24 px-4 bg-card">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="section-title mb-6 text-white">Ready to Get Started?</h2>
          <p className="text-muted-foreground mb-8 text-lg">
            Explore instructors and choose the mentorship that fits your goals.
          </p>
          <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold tracking-wide uppercase">
            <Link href="/instructors">Browse Instructors</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
