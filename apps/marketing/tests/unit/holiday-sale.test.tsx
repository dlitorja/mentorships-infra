import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CourseCard } from "../../components/portals/course-card";
import { getPortalBySlug } from "../../config/instructor-portals";
import { getSaleDisplay } from "../../config/holiday-sale";

/**
 * Holiday Season Sale guardrails for artwithneil.com.
 *
 * The prices and percentages below come from the live Kajabi landing pages and
 * are asserted here so a well-meaning edit cannot silently point the page at a
 * launch-promo offer or drift from Kajabi's numbers.
 */
describe("Neil Gray holiday sale", () => {
  const portal = getPortalBySlug("neil-gray");

  it("links every course and bundle to its own Kajabi checkout", () => {
    const drapery = portal?.courses.find((course) => course.title.includes("Drapery"));
    const characterDesign = portal?.courses.find((course) => course.title.includes("Character Design"));
    const bundle = portal?.bundles.find((item) => item.title.includes("Bundle"));

    expect(drapery?.title).toBe("Drawing Drapery and Clothing with Neil Gray");
    expect(drapery?.url).toBe("https://huckleberryart.mykajabi.com/offers/qNGTHsfR/checkout");

    expect(characterDesign?.title).toBe("Character Design with Neil Gray");
    expect(characterDesign?.url).toBe("https://huckleberryart.mykajabi.com/offers/rfxtcuvg/checkout");

    expect(bundle?.title).toBe("Complete Character Art Bundle");
    expect(bundle?.url).toBe("https://huckleberryart.mykajabi.com/offers/zoLU2aSF/checkout");

    // Swapping two offers would still satisfy a loose containment check, so
    // assert the three checkouts are distinct as well.
    expect(new Set([drapery?.url, characterDesign?.url, bundle?.url]).size).toBe(3);
  });

  it("keeps sale prices and percentages in step with Kajabi", () => {
    const [bundle] = portal?.bundles ?? [];
    const drapery = portal?.courses.find((course) => course.title.includes("Drapery"));
    const characterDesign = portal?.courses.find((course) => course.title.includes("Character Design"));

    expect(bundle?.sale).toEqual({ salePrice: 130, regularPrice: 375, percentOff: 65 });
    expect(drapery?.sale).toEqual({ salePrice: 85, regularPrice: 175, percentOff: 51 });
    expect(characterDesign?.sale).toEqual({ salePrice: 95, regularPrice: 195, percentOff: 51 });
  });

  it("formats the badge the same way as Kajabi's landing pages", () => {
    expect(getSaleDisplay({ salePrice: 85, regularPrice: 175, percentOff: 51 })?.badge).toBe(
      "HOLIDAY SALE — 51% OFF · LIMITED TIME ONLY!"
    );
  });

  it("renders the badge with the title and the regular price crossed out", () => {
    const sale = getSaleDisplay({ salePrice: 85, regularPrice: 175, percentOff: 51 });

    render(
      <CourseCard
        title="Drawing Drapery and Clothing with Neil Gray"
        description="Master the art of drawing fabric, folds, and clothing on figures."
        url="https://huckleberryart.mykajabi.com/offers/qNGTHsfR/checkout"
        saleBadge={sale?.badge}
        price={sale?.salePrice}
        regularPrice={sale?.regularPrice}
      />
    );

    expect(screen.getByText("HOLIDAY SALE — 51% OFF · LIMITED TIME ONLY!")).toBeTruthy();

    const price = screen.getByText("$85");
    expect(price.textContent).toBe("$85");

    const regularPrice = screen.getByText("$175");
    expect(regularPrice.tagName).toBe("S");

    const cta = screen.getByRole("link", { name: /BUY NOW|View Course/i });
    expect(cta.getAttribute("href")).toBe(
      "https://huckleberryart.mykajabi.com/offers/qNGTHsfR/checkout"
    );
  });
});
