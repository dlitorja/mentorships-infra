'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export interface ChatImageDownloadItem {
  url: string;
  fileName: string;
  isDownloading?: boolean;
}

interface ChatImageLightboxProps {
  images: string[];
  downloadItems?: Array<ChatImageDownloadItem | null>;
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload?: (url: string, fileName: string) => void;
}

export function ChatImageLightbox({
  images,
  downloadItems = [],
  initialIndex,
  open,
  onOpenChange,
  onDownload,
}: ChatImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrentIndex(initialIndex);
    }
  }, [initialIndex, open]);

  useEffect(() => {
    setImageError(false);
  }, [currentIndex, open]);

  useEffect(() => {
    if (!open || images.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCurrentIndex((prev) => (prev + 1) % images.length);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [images.length, open]);

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  const currentImage = images[currentIndex];
  const currentDownload = downloadItems[currentIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] w-screen h-screen max-h-screen p-0 gap-0 bg-black/95 border-none rounded-none [&>button]:hidden">
        <DialogTitle className="sr-only">
          Chat image {currentIndex + 1} of {images.length}
        </DialogTitle>
        <div className="relative h-full w-full flex items-center justify-center">
          <div className="absolute top-4 right-4 z-50 flex gap-2">
            {currentDownload && onDownload && (
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => onDownload(currentDownload.url, currentDownload.fileName)}
                disabled={currentDownload.isDownloading}
                aria-label={`Download ${currentDownload.fileName}`}
              >
                {currentDownload.isDownloading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Download className="h-5 w-5" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-6 w-6" />
              <span className="sr-only">Close</span>
            </Button>
          </div>

          {images.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-4 z-50 h-12 w-12 text-white hover:bg-white/20 hover:text-white"
              onClick={goToPrevious}
              aria-label="Previous image"
            >
              <ArrowLeft className="h-6 w-6" />
            </Button>
          )}

          <div className="h-full w-full p-4 md:p-8 flex items-center justify-center">
            {currentImage && !imageError ? (
              <img
                src={currentImage}
                alt={`Chat attachment ${currentIndex + 1}`}
                className="max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] md:max-w-[calc(100vw-4rem)] md:max-h-[calc(100vh-4rem)] object-contain"
                onError={() => setImageError(true)}
              />
            ) : (
              <p className="text-white/70">Image unavailable</p>
            )}
          </div>

          {images.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 z-50 h-12 w-12 text-white hover:bg-white/20 hover:text-white"
              onClick={goToNext}
              aria-label="Next image"
            >
              <ArrowRight className="h-6 w-6" />
            </Button>
          )}

          {images.length > 1 && (
            <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
              {currentIndex + 1} / {images.length}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
