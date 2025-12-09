"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

interface PortfolioLightboxProps {
  images: string[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instructorName: string;
}

export function PortfolioLightbox({
  images,
  initialIndex,
  open,
  onOpenChange,
  instructorName,
}: PortfolioLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  // Update current index when initialIndex changes (when opening a different image)
  useEffect(() => {
    if (open) {
      setCurrentIndex(initialIndex);
    }
  }, [open, initialIndex]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCurrentIndex((prev) => (prev + 1) % images.length);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, images.length, onOpenChange]);

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  const currentImage = images[currentIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] w-screen h-screen max-h-screen p-0 gap-0 bg-black/95 border-none rounded-none [&>button]:hidden">
        <DialogTitle className="sr-only">
          {instructorName} Portfolio - Image {currentIndex + 1} of {images.length}
        </DialogTitle>
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Close Button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20 hover:text-white h-10 w-10"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-6 w-6" />
            <span className="sr-only">Close</span>
          </Button>

          {/* Previous Button */}
          {images.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-4 z-50 text-white hover:bg-white/20 hover:text-white h-12 w-12"
              onClick={goToPrevious}
              aria-label="Previous image"
            >
              <ArrowLeft className="h-6 w-6" />
            </Button>
          )}

          {/* Image */}
          <div className="relative w-full h-full flex items-center justify-center p-4 md:p-8">
            <Image
              src={currentImage}
              alt={`${instructorName} portfolio work ${currentIndex + 1}`}
              fill
              className="object-contain"
              sizes="100vw"
              priority
            />
          </div>

          {/* Next Button */}
          {images.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 z-50 text-white hover:bg-white/20 hover:text-white h-12 w-12"
              onClick={goToNext}
              aria-label="Next image"
            >
              <ArrowRight className="h-6 w-6" />
            </Button>
          )}

          {/* Image Counter */}
          {images.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 bg-black/70 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-medium">
              {currentIndex + 1} / {images.length}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

