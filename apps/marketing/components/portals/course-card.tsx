import Image from "next/image";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface CourseCardProps {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
}

export function CourseCard({ title, description, url, imageUrl }: CourseCardProps) {
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-lg">
      {imageUrl && (
        <div className="relative aspect-video w-full overflow-hidden">
          <Image
            src={imageUrl}
            alt={title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        </div>
      )}
      <CardHeader>
        <CardTitle className="line-clamp-2">{title}</CardTitle>
        {description && <CardDescription className="line-clamp-3">{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <Button asChild className="w-full">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            View Course
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}