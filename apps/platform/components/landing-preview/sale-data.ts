/**
 * Holiday Season Sale data for the landing preview.
 *
 * Course cards link to Kajabi **landing pages**, never straight to a checkout.
 * Each landing page's own "Buy Now" button routes to the correct offer, so
 * deep-linking a checkout would only bypass the course details.
 *
 * Kajabi is the source of truth for pricing. The pages and percentages below
 * were verified against the live Kajabi pages on 2026-11-17:
 *
 * | Course             | Landing page                          | Checkout (behind Buy Now) | Sale | Regular | Off |
 * | ------------------ | ------------------------------------- | ------------------------- | ---- | ------- | --- |
 * | Bundle             | /neil-gray-course-bundle              | offers/zoLU2aSF/checkout  | $130 | $375    | 65% |
 * | Character Design   | /character-design-with-neil-gray      | offers/rfxtcuvg/checkout  | $95  | $195    | 51% |
 * | Drapery & Clothing | /drawing-drapery-and-clothing-with-neil-gray | offers/qNGTHsfR/checkout | $85 | $175 | 51% |
 *
 * Percentages must match Kajabi exactly — do not round them. Similarly-named
 * launch-promo offers and landing pages exist in the same Kajabi account; the
 * three destinations above are the only correct ones.
 *
 * To end the sale: revert the prices in Kajabi (Bundle offer → $270, Character
 * Design → $195, Drapery → $175), then drop this module and its sale badges
 * from the preview components. The offers and landing pages do not change.
 */
export const SALE = {
  name: "Holiday Season Sale",
  /** Sitewide sale floor is 50%; Neil's own courses are 51–65% off. */
  subheader: "Courses starting at 50% OFF — for a limited time only!",
  /** Matches Kajabi's per-page label, e.g. "HOLIDAY SALE — 65% OFF · LIMITED TIME ONLY!". */
  badgePrefix: "HOLIDAY SALE",
  badgeSuffix: "LIMITED TIME ONLY!",
} as const;

export type SaleCourse = {
  id: string;
  title: string;
  percentOff: number;
  /** Price charged by Kajabi while the sale is live, in whole dollars. */
  salePrice: number;
  /** Regular price, rendered crossed out next to the sale price. */
  regularPrice: number;
  /** Kajabi landing page for the course, not its checkout. */
  landingPageUrl: string;
  /** Wide image used by the hero carousel. */
  carouselImage: string;
  /** Square image used by the sale card grid. */
  cardImage: string;
};

export const SALE_COURSES: readonly SaleCourse[] = [
  {
    id: "bundle",
    title: "Complete Character Art Bundle",
    percentOff: 65,
    salePrice: 130,
    regularPrice: 375,
    landingPageUrl: "https://huckleberryart.mykajabi.com/neil-gray-course-bundle",
    carouselImage: "/images/preview/carousel-1.jpg",
    cardImage: "/images/preview/sale-bundle.jpg",
  },
  {
    id: "character-design",
    title: "Character Design with Neil Gray",
    percentOff: 51,
    salePrice: 95,
    regularPrice: 195,
    landingPageUrl:
      "https://huckleberryart.mykajabi.com/character-design-with-neil-gray",
    carouselImage: "/images/preview/carousel-3.jpg",
    cardImage: "/images/preview/sale-new-course-2.jpg",
  },
  {
    id: "drapery",
    title: "Drawing Drapery and Clothing with Neil Gray",
    percentOff: 51,
    salePrice: 85,
    regularPrice: 175,
    landingPageUrl:
      "https://huckleberryart.mykajabi.com/drawing-drapery-and-clothing-with-neil-gray",
    carouselImage: "/images/preview/carousel-2.jpg",
    cardImage: "/images/preview/sale-new-course-1.jpg",
  },
];

/** "HOLIDAY SALE — 65% OFF · LIMITED TIME ONLY!" — matches Kajabi exactly. */
export function saleBadge(percentOff: number): string {
  return `${SALE.badgePrefix} — ${percentOff}% OFF · ${SALE.badgeSuffix}`;
}
