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
  /** Sale badge rendered with the title, e.g. "HOLIDAY SALE — 65% OFF · LIMITED TIME ONLY!". */
  saleBadge?: string;
  /** Current price in whole dollars, rendered with the regular price crossed out. */
  price?: number;
  /** Regular price, rendered crossed out next to the current price. */
  regularPrice?: number;
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
  saleBadge,
  price,
  regularPrice,
  variant = "default",
  priority = false,
}: BaseCardProps) {
  const showPrice = price !== undefined && regularPrice !== undefined;

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
          <div className="relative h-64 w-full overflow-hidden">
            <Image
              src={imageUrl}
              alt={title}
              fill
              className="object-contain transition-transform duration-300 hover:scale-105"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority={priority}
            />
          </div>
        </a>
      )}
      <CardHeader>
        {saleBadge && (
          <span className="mb-2 inline-block w-fit bg-red-600 px-3 py-1 text-xs font-semibold text-white shadow">
            {saleBadge}
          </span>
        )}
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
      <CardContent className={promoText || showPrice ? "space-y-4" : "pt-0"}>
        {showPrice && (
          <p className="text-base font-semibold text-foreground">
            <span>${price}</span>{" "}
            <span className="text-sm font-normal text-muted-foreground">
              — Regular Price <s>${regularPrice}</s>
            </span>
          </p>
        )}
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