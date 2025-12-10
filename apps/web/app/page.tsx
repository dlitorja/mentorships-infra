import { HeroSection } from "@/components/landing/hero-section";
import { InstructorCarousel } from "@/components/landing/instructor-carousel";
import { MatchingSection } from "@/components/landing/matching-section";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Testimonials } from "@/components/landing/testimonials";
import { Footer } from "@/components/navigation/footer";

export default function HomePage() {
  return (
    <>
      <main className="min-h-screen textured-gradient text-foreground relative">
        <div className="relative z-10">
          <HeroSection />
          <InstructorCarousel />
          <MatchingSection />
          <HowItWorks />
          <Testimonials />
        </div>
      </main>
      <Footer />
    </>
  );
}
