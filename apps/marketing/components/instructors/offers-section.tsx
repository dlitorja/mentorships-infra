"use client";

import { useEffect, useState } from "react";
import { OfferButton } from "./offer-button";

interface InventoryStatus {
  one_on_one_inventory: number;
  group_inventory: number;
}

interface OffersSectionProps {
  offers: Array<{
    kind: "oneOnOne" | "group";
    label: string;
    url: string;
    active?: boolean;
  }>;
  instructorSlug: string;
}

export function OffersSection({ offers, instructorSlug }: OffersSectionProps) {
  const [inventory, setInventory] = useState<InventoryStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchInventory() {
      try {
        const response = await fetch(`/api/instructor/inventory?slug=${instructorSlug}`);
        if (response.ok) {
          const data = await response.json();
          setInventory(data);
        }
      } catch (error) {
        console.error("Failed to fetch inventory:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchInventory();
  }, [instructorSlug]);

  const activeOffers = offers.filter((offer) => offer.active !== false);

  if (loading) {
    return (
      <div>
        <h2 className="text-2xl font-semibold mb-3">Purchase</h2>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-3">Purchase</h2>
      <p className="text-muted-foreground mb-4">
        Purchases are handled on Kajabi. You&apos;ll be redirected to an external checkout.
      </p>

      <div className="space-y-4">
        {activeOffers.map((offer) => (
          <OfferButton
            key={offer.kind}
            kind={offer.kind}
            label={offer.label}
            url={offer.url}
            instructorSlug={instructorSlug}
            inventory={{
              oneOnOne: inventory?.one_on_one_inventory ?? 0,
              group: inventory?.group_inventory ?? 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}
