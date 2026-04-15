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
  priority?: boolean;
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
  priority = false,
}: BaseCardProps) {
  return (
    <Card
      className={`overflow-hidden transition-all hover:shadow-lg ${
        variant === "bundle"
          ? "border-primary/50 bg-gradient-to-br from-primary/5 to-indigo-500/5 shadow-md"
          : ""
      }`}
    >
      {imageUrl && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
          tabIndex={-1}
          aria-hidden="true"
        >
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            <Image
              src={imageUrl}
              alt={title}
              fill
              className="object-cover transition-transform duration-300 hover:scale-105"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority={priority}
            />
          </div>
        </a>
      )}
      <CardHeader>
        {icon || variant === "bundle" ? (
          <div className="flex items-start gap-3">
            {icon && <span className="mt-1 text-primary shrink-0">{icon}</span>}
            <CardTitle className="line-clamp-2 text-xl">{title}</CardTitle>
          </div>
        ) : (
          <CardTitle className="line-clamp-2 text-xl">{title}</CardTitle>
        )}
        {description && (
          <CardDescription className="line-clamp-3 text-base">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className={promoText ? "space-y-4" : "pt-0"}>
        {promoText && (
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
            {promoText}
          </p>
        )}
        <Button
          asChild
          size="lg"
          className="vibrant-gradient-button w-full text-lg font-semibold"
        >
          <a href={url} target="_blank" rel="noopener noreferrer">
            {buttonText}
            <ExternalLink className="ml-2 h-5 w-5" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}