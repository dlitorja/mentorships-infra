"use client";

import { useState } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { PortfolioLightbox } from "./portfolio-lightbox";

interface PortfolioGalleryProps {
  images: string[];
  instructorName: string;
}

function GalleryImage({ src, alt, onError }: { src: string; alt: string; onError?: () => void }) {
  const [error, setError] = useState(false);

  const handleError = () => {
    setError(true);
    onError?.();
  };

  if (error) {
    // Show a visual placeholder instead of text when the image fails to load
    return (
      <Image
        src="/placeholder-instructor.svg"
        alt="Placeholder image"
        fill
        className="object-cover"
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      className="object-cover"
      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
      onError={handleError}
    />
  );
}

export function PortfolioGallery({
  images,
  instructorName,
}: PortfolioGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());

  const handleImageClick = (index: number) => {
    if (failedImages.has(index)) return;
    setSelectedIndex(index);
    setLightboxOpen(true);
  };

  const handleImageError = (index: number) => {
    setFailedImages((prev) => new Set(prev).add(index));
  };

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {images.map((image, index) => (
          <Card
            key={index}
            className={`overflow-hidden transition-transform hover:scale-105 hover:shadow-lg ${
              failedImages.has(index) ? "opacity-60 cursor-default" : "cursor-pointer"
            }`}
            onClick={() => handleImageClick(index)}
          >
            <div className="relative aspect-[4/3] w-full">
              <GalleryImage
                src={image}
                alt={`${instructorName} portfolio work ${index + 1}`}
                onError={() => handleImageError(index)}
              />
            </div>
          </Card>
        ))}
      </div>

      <PortfolioLightbox
        images={images}
        initialIndex={selectedIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        instructorName={instructorName}
      />
    </>
  );
}
