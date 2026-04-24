import type { Metadata } from "next";
import { PreviewHero } from "@/components/landing-preview/preview-hero";
import { SaleBanner } from "@/components/landing-preview/sale-banner";
import { InstructorCards } from "@/components/landing-preview/instructor-cards";
import { InstructorShowcase } from "@/components/landing-preview/instructor-showcase";
import { HowItWorks } from "@/components/landing-preview/how-it-works";
import { Testimonials } from "@/components/landing-preview/testimonials";
import { NewsletterSection } from "@/components/landing-preview/newsletter-section";
import { PreviewFooter } from "@/components/landing-preview/preview-footer";

export const metadata: Metadata = {
  title: "Huckleberry Art Academy | Learn from Industry Pros",
  description:
    "1-on-1 mentorships with working professionals from gaming, TV, and film. Get personalized guidance to build the skills and portfolio you need.",
};

export default function PreviewPage() {
  return (
    <div className="bg-[#0f1117] text-[#f5f5f5]">
      <PreviewHero />
      <SaleBanner />
      <InstructorCards />
      <HowItWorks />
      <InstructorShowcase />
      <Testimonials />
      <NewsletterSection />
      <PreviewFooter />
    </div>
  );
}