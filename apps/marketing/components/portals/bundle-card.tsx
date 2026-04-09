import Image from "next/image";
import { ShoppingCart, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface BundleCardProps {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
}

export function BundleCard({ title, description, url, imageUrl }: BundleCardProps) {
  return (
    <Card className="overflow-hidden border-primary/50 bg-primary/5 shadow-md transition-shadow hover:shadow-lg">
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
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <CardTitle className="line-clamp-2">{title}</CardTitle>
        </div>
        {description && <CardDescription className="line-clamp-3">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm font-medium text-primary">
          Save more with this bundle! Get both courses together at a discounted rate.
        </p>
        <Button asChild className="w-full">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            Get Bundle
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}