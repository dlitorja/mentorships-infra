import { BaseCard } from "./base-card";

interface CourseCardProps {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
}

export function CourseCard({ title, description, url, imageUrl }: CourseCardProps) {
  return (
    <BaseCard
      title={title}
      description={description}
      url={url}
      imageUrl={imageUrl}
      buttonText="View Course"
    />
  );
}