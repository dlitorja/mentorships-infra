/**
 * Holiday Season Sale data for the landing preview.
 *
 * Kajabi is the source of truth for pricing. The offer URLs and percentages
 * below were verified against the live Kajabi landing pages on 2026-11-17:
 *
 * | Offer              | Checkout                 | Sale | Regular | Off |
 * | ------------------ | ------------------------ | ---- | ------- | --- |
 * | Bundle             | offers/zoLU2aSF/checkout | $130 | $375    | 65% |
 * | Character Design   | offers/rfxtcuvg/checkout | $95  | $195    | 51% |
 * | Drapery & Clothing | offers/qNGTHsfR/checkout | $85  | $175    | 51% |
 *
 * Percentages must match Kajabi exactly — do not round them, and do not point
 * these links at a launch-promo offer. Similarly-named promo offers exist in
 * the same Kajabi account; the three slugs above are the only correct ones.
 *
 * To end the sale: revert the prices in Kajabi (Bundle offer → $270, Character
 * Design → $195, Drapery → $175), then drop this module and its sale badges
 * from the preview components. The offer URLs do not change.
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
  checkoutUrl: string;
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
    checkoutUrl: "https://huckleberryart.mykajabi.com/offers/zoLU2aSF/checkout",
    carouselImage: "/images/preview/carousel-1.jpg",
    cardImage: "/images/preview/sale-bundle.jpg",
  },
  {
    id: "character-design",
    title: "Character Design with Neil Gray",
    percentOff: 51,
    salePrice: 95,
    regularPrice: 195,
    checkoutUrl: "https://huckleberryart.mykajabi.com/offers/rfxtcuvg/checkout",
    carouselImage: "/images/preview/carousel-3.jpg",
    cardImage: "/images/preview/sale-new-course-2.jpg",
  },
  {
    id: "drapery",
    title: "Drawing Drapery and Clothing with Neil Gray",
    percentOff: 51,
    salePrice: 85,
    regularPrice: 175,
    checkoutUrl: "https://huckleberryart.mykajabi.com/offers/qNGTHsfR/checkout",
    carouselImage: "/images/preview/carousel-2.jpg",
    cardImage: "/images/preview/sale-new-course-1.jpg",
  },
];

/** "HOLIDAY SALE — 65% OFF · LIMITED TIME ONLY!" — matches Kajabi exactly. */
export function saleBadge(percentOff: number): string {
  return `${SALE.badgePrefix} — ${percentOff}% OFF · ${SALE.badgeSuffix}`;
}
