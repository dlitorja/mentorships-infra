import Image from 'next/image';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { InstructorCarousel } from '@/components/instructors/instructor-carousel';
import { TestimonialsCarousel } from '@/components/testimonials/testimonials-carousel';
import { Footer } from '@/components/navigation/footer';

export default function HomePage(): React.JSX.Element {
  return (
    <>
      <main className="min-h-screen bg-background text-foreground">
        {/* Hero Section */}
        <section className="py-24 px-4">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-8 flex justify-center">
              <div className="relative h-24 w-auto" style={{ width: '172px' }}>
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
            <h1 className="section-title mb-6">Our Instructors</h1>
            <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
              Connect with world-class art instructors from gaming, TV, film, and independent studios
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 uppercase tracking-wide font-semibold">
                <Link href="/instructors">View All Instructors</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 uppercase tracking-wide font-semibold">
                <Link href="#how-it-works">How It Works</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Instructors Carousel */}
        <section id="instructors" className="py-20 px-4">
          <div className="mx-auto max-w-7xl">
            <ErrorBoundary fallback={<div className="w-full h-32 bg-card rounded-xl flex items-center justify-center"><p className="text-muted-foreground text-sm">Unable to load instructors.</p></div>}>
              <InstructorCarousel />
            </ErrorBoundary>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="py-20 px-4 border-t border-border">
          <div className="mx-auto max-w-5xl">
            <h2 className="section-title mb-16">How It Works</h2>
            <div className="grid gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-6 text-xl font-bold">
                  1
                </div>
                <h3 className="text-lg font-semibold uppercase tracking-wide mb-3">Choose an Instructor</h3>
                <p className="text-muted-foreground">
                  Browse profiles, portfolios, and specialties to find your best fit.
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-6 text-xl font-bold">
                  2
                </div>
                <h3 className="text-lg font-semibold uppercase tracking-wide mb-3">Purchase Your Session</h3>
                <p className="text-muted-foreground">
                  When you&apos;re ready, complete your purchase on the instructor&apos;s offer page.
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-6 text-xl font-bold">
                  3
                </div>
                <h3 className="text-lg font-semibold uppercase tracking-wide mb-3">Start Your Mentorship</h3>
                <p className="text-muted-foreground">
                  After your purchase, you&apos;ll receive onboarding details in your email inbox.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section id="testimonials" className="py-20 px-4 border-t border-border">
          <div className="mx-auto max-w-7xl">
            <h2 className="section-title mb-6">What Students Say</h2>
            <p className="text-center text-muted-foreground mb-16">
              Hear from students about their mentorship experience
            </p>
            <ErrorBoundary fallback={<div className="w-full h-32 bg-card rounded-xl flex items-center justify-center"><p className="text-muted-foreground text-sm">Unable to load testimonials.</p></div>}>
              <TestimonialsCarousel />
            </ErrorBoundary>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 px-4 border-t border-border">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="section-title mb-6">Ready to Get Started?</h2>
            <p className="text-muted-foreground mb-10">
              Explore instructors and choose the mentorship that fits your goals.
            </p>
            <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 uppercase tracking-wide font-semibold">
              <Link href="/instructors">Browse Instructors</Link>
            </Button>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
