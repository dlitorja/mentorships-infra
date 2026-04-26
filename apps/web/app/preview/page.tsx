import type { Metadata } from "next";
import { PreviewHero } from "@/components/landing-preview/preview-hero";
import { SaleBanner } from "@/components/landing-preview/sale-banner";
import { InstructorShowcase } from "@/components/landing-preview/instructor-showcase";
import { NewsletterSection } from "@/components/landing-preview/newsletter-section";
import { PreviewFooter } from "@/components/landing-preview/preview-footer";
import { StoreGrid } from "@/components/landing-preview/store-grid";

export const metadata: Metadata = {
  title: "Huckleberry Art Academy | Learn from Industry Pros",
  description:
    "1-on-1 mentorships with working professionals from gaming, TV, and film. Get personalized guidance to build the skills and portfolio you need.",
};

export default function PreviewPage() {
  return (
    <div className="bg-white text-[#1a1a2e]">
      <PreviewHero />
      <SaleBanner />
      <StoreGrid />
      <InstructorShowcase />
      <NewsletterSection />
      <PreviewFooter />
    </div>
  );
}
