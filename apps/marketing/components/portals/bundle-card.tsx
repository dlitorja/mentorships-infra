import React from "react";
import { BaseCard } from "./base-card";

interface BundleCardProps {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  promoText?: string;
  buttonText?: string;
  saleBadge?: string;
  price?: number;
  regularPrice?: number;
}

export function BundleCard({
  title,
  description,
  url,
  imageUrl,
  promoText,
  buttonText,
  saleBadge,
  price,
  regularPrice,
}: BundleCardProps): React.JSX.Element {
  return (
    <BaseCard
      title={title}
      description={description}
      url={url}
      imageUrl={imageUrl}
      buttonText={buttonText ?? "Get the Bundle"}
      promoText={promoText}
      saleBadge={saleBadge}
      price={price}
      regularPrice={regularPrice}
      variant="bundle"
    />
  );
}
