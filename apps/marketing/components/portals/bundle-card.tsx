import { BaseCard } from "./base-card";

interface BundleCardProps {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  promoText?: string;
}

export function BundleCard({ title, description, url, imageUrl, promoText }: BundleCardProps) {
  return (
    <BaseCard
      title={title}
      description={description}
      url={url}
      imageUrl={imageUrl}
      buttonText="Get the Bundle — Save 20%"
      promoText={
        promoText ||
        "Save more with this bundle! Get both courses together at a discounted rate."
      }
      variant="bundle"
    />
  );
}