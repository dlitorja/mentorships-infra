import { HeroSection } from "@/components/landing/hero-section";
import { InstructorCarousel } from "@/components/landing/instructor-carousel";
import { AIMatchingSection } from "@/components/landing/ai-matching-section";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Testimonials } from "@/components/landing/testimonials";
import { Footer } from "@/components/navigation/footer";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <HeroSection />
      <InstructorCarousel />
      <AIMatchingSection />
      <HowItWorks />
      <Testimonials />
      <Footer />
    </main>
  );
}
