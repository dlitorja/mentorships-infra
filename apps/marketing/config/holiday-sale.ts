/**
 * Holiday Season Sale — the single source of truth for sale copy, offer URLs
 * and sale prices on the artwithneil.com (Neil Gray) course page.
 *
 * Kajabi is the source of truth for pricing. The offer URLs and percentages
 * below were verified against the live Kajabi landing pages on 2026-11-17:
 *
 * | Offer              | Checkout                                  | Sale | Regular | Off |
 * | ------------------ | ----------------------------------------- | ---- | ------- | --- |
 * | Bundle             | offers/zoLU2aSF/checkout                  | $130 | $375    | 65% |
 * | Character Design   | offers/rfxtcuvg/checkout                  | $95  | $195    | 51% |
 * | Drapery & Clothing | offers/qNGTHsfR/checkout                  | $85  | $175    | 51% |
 *
 * Percentages must match Kajabi exactly — do not round them, and do not point
 * these links at a launch-promo offer. Similarly-named promo offers exist in
 * the same Kajabi account; the three slugs above are the only correct ones.
 *
 * To end the sale:
 *   1. Revert the prices in Kajabi (Bundle offer → $270, Character Design →
 *      $195, Drapery → $175). The offer URLs do not change.
 *   2. Set `isActive` to `false`. The page then hides the sale banner, the
 *      % OFF badges and the crossed-out regular prices, and keeps linking to
 *      the same checkouts.
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

/** Kajabi checkout URLs for Neil Gray's courses. */
export const NEIL_GRAY_OFFERS = {
  bundle: "https://huckleberryart.mykajabi.com/offers/zoLU2aSF/checkout",
  characterDesign: "https://huckleberryart.mykajabi.com/offers/rfxtcuvg/checkout",
  drapery: "https://huckleberryart.mykajabi.com/offers/qNGTHsfR/checkout",
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
