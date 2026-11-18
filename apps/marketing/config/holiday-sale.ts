/**
 * Holiday Season Sale — the single source of truth for sale copy, landing-page
 * URLs and sale prices on the artwithneil.com (Neil Gray) course page.
 *
 * Course buttons link to Kajabi **landing pages**, never straight to a
 * checkout. Each landing page's own "Buy Now" button routes to the correct
 * offer, so deep-linking a checkout here would only bypass the course details.
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
 * To end the sale:
 *   1. Revert the prices in Kajabi (Bundle offer → $270, Character Design →
 *      $195, Drapery → $175). The offers and landing pages do not change.
 *   2. Set `isActive` to `false`. The page then hides the sale banner, the
 *      % OFF badges and the crossed-out regular prices, and keeps linking to
 *      the same landing pages.
 */
export const HOLIDAY_SALE = {
  isActive: true,
  name: "Holiday Season Sale",
  /** Sitewide sale floor is 50%; Neil's own courses are 51–65% off. */
  subheader: "Courses starting at 50% OFF — for a limited time only!",
  /** Matches Kajabi's per-page label, e.g. "HOLIDAY SALE — 65% OFF · LIMITED TIME ONLY!". */
  badgePrefix: "HOLIDAY SALE",
  badgeSuffix: "LIMITED TIME ONLY!",
} as const;

/** Kajabi landing pages for Neil Gray's courses. */
export const NEIL_GRAY_LANDING_PAGES = {
  bundle: "https://huckleberryart.mykajabi.com/neil-gray-course-bundle",
  characterDesign: "https://huckleberryart.mykajabi.com/character-design-with-neil-gray",
  drapery: "https://huckleberryart.mykajabi.com/drawing-drapery-and-clothing-with-neil-gray",
} as const;

export interface SalePricing {
  /** Price charged by Kajabi while the sale is live, in whole dollars. */
  salePrice: number;
  /** Regular price rendered crossed out next to the sale price. */
  regularPrice: number;
  /** Discount shown on Kajabi. Must match Kajabi exactly. */
  percentOff: number;
}

export interface SaleDisplay {
  badge: string;
  salePrice: number;
  regularPrice: number;
}

/**
 * Returns the badge and prices to render for a course, or `undefined` when the
 * sale is off (or the course has no sale pricing), so ending the sale is a
 * one-flag change.
 */
export function getSaleDisplay(sale: SalePricing | undefined): SaleDisplay | undefined {
  if (!HOLIDAY_SALE.isActive || !sale) {
    return undefined;
  }

  return {
    badge: `${HOLIDAY_SALE.badgePrefix} — ${sale.percentOff}% OFF · ${HOLIDAY_SALE.badgeSuffix}`,
    salePrice: sale.salePrice,
    regularPrice: sale.regularPrice,
  };
}
