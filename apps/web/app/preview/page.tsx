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
    // Add a subtle paper-like textured background behind the whole page
    <div
      className="relative text-[#1a1a2e]"
      style={{
        // Paper-like texture, now much lighter so the page reads as white
        backgroundColor: "#ffffff",
        backgroundImage:
          "radial-gradient(rgba(0,0,0,0.015) 1px, transparent 1px), radial-gradient(rgba(0,0,0,0.008) 1px, transparent 1px)",
        backgroundSize: "24px 24px, 48px 48px",
        backgroundPosition: "0 0, 12px 12px",
        backgroundAttachment: "fixed",
      }}
    >
      <PreviewHero />
      <SaleBanner />
      <StoreGrid />
      <InstructorShowcase />
      <NewsletterSection />
      <PreviewFooter />
    </div>
  );
}
