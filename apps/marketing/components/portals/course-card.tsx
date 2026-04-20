import { BaseCard } from "./base-card";

interface CourseCardProps {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  promoText?: string;
}

export function CourseCard({ title, description, url, imageUrl, promoText }: CourseCardProps) {
  return (
    <BaseCard
      title={title}
      description={description}
      url={url}
      imageUrl={imageUrl}
      buttonText="View Course"
      promoText={promoText}
    />
  );
}