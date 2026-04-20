import { BaseCard } from "./base-card";

interface CourseCardProps {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  promoText?: string;
  buttonText?: string;
}

export function CourseCard({ title, description, url, imageUrl, promoText, buttonText }: CourseCardProps) {
  return (
    <BaseCard
      title={title}
      description={description}
      url={url}
      imageUrl={imageUrl}
      buttonText={buttonText || "View Course"}
      promoText={promoText}
    />
  );
}