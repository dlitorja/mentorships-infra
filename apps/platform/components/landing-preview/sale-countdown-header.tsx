"use client";

import { SALE, SALE_COURSES } from "./sale-data";

export function SaleCountdownHeader() {
  return (
    <section className="bg-background px-6 pt-10">
      <div className="mx-auto max-w-5xl text-center">
        <a
          href={SALE_COURSES[0].landingPageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-base sm:text-lg font-semibold uppercase tracking-wider text-white bg-red-600 hover:bg-red-700 px-6 py-3 shadow-md"
        >
          {SALE.name}
        </a>
        <div className="mt-4 text-muted-foreground text-xs uppercase tracking-widest">
          {SALE.subheader}
        </div>
      </div>
    </section>
  );
}
