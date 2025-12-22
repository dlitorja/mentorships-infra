"use client";

import { useState } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { PortfolioLightbox } from "./portfolio-lightbox";

interface PortfolioGalleryProps {
  images: string[];
  instructorName: string;
}

export function PortfolioGallery({
  images,
  instructorName,
}: PortfolioGalleryProps): React.JSX.Element {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleImageClick = (index: number) => {
    setSelectedIndex(index);
    setLightboxOpen(true);
  };

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {images.map((image, index) => (
          <Card
            key={index}
            className="overflow-hidden cursor-pointer transition-transform hover:scale-105 hover:shadow-lg"
            onClick={() => handleImageClick(index)}
          >
            <div className="relative aspect-[4/3] w-full">
              <Image
                src={image}
                alt={`${instructorName} portfolio work ${index + 1}`}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
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

