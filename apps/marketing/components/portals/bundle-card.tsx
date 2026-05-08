import React from "react";
import { BaseCard } from "./base-card";

interface BundleCardProps {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  promoText?: string;
  buttonText?: string;
}

export function BundleCard({ title, description, url, imageUrl, promoText, buttonText }: BundleCardProps): React.JSX.Element {
  return (
    <BaseCard
      title={title}
      description={description}
      url={url}
      imageUrl={imageUrl}
buttonText={buttonText ?? "Get the Bundle — 20% Off"}
      promoText={
        promoText ??
        "Save more with this bundle! Get both courses together at a discounted rate."
      }
      variant="bundle"
    />
  );
}