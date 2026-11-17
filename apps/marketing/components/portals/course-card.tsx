import { BaseCard } from "./base-card";

interface CourseCardProps {
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

export function CourseCard({
  title,
  description,
  url,
  imageUrl,
  promoText,
  buttonText,
  saleBadge,
  price,
  regularPrice,
}: CourseCardProps) {
  return (
    <BaseCard
      title={title}
      description={description}
      url={url}
      imageUrl={imageUrl}
      buttonText={buttonText || "View Course"}
      promoText={promoText}
      saleBadge={saleBadge}
      price={price}
      regularPrice={regularPrice}
    />
  );
}
