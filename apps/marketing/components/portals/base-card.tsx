import Image from "next/image";
import { ExternalLink } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface BaseCardProps {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  buttonText: string;
  icon?: React.ReactNode;
  promoText?: string;
  variant?: "default" | "bundle";
}

export function BaseCard({
  title,
  description,
  url,
  imageUrl,
  buttonText,
  icon,
  promoText,
  variant = "default",
}: BaseCardProps) {
  return (
    <Card
      className={`overflow-hidden transition-shadow hover:shadow-lg ${
        variant === "bundle" ? "border-primary/50 bg-primary/5 shadow-md" : ""
      }`}
    >
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
        {icon || variant === "bundle" ? (
          <div className="flex items-center gap-2">
            {icon && <span className="text-primary">{icon}</span>}
            <CardTitle className="line-clamp-2">{title}</CardTitle>
          </div>
        ) : (
          <CardTitle className="line-clamp-2">{title}</CardTitle>
        )}
        {description && <CardDescription className="line-clamp-3">{description}</CardDescription>}
      </CardHeader>
      <CardContent className={promoText ? "space-y-4" : ""}>
        {promoText && <p className="text-sm font-medium text-primary">{promoText}</p>}
        <Button asChild className="w-full">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            {buttonText}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}