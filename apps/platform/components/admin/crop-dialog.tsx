"use client";

import React, { useState, useRef, useCallback } from "react";
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface CropDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  image: File | string;
  onConfirm: (croppedFile: File) => void;
  onCancel: () => void;
  aspectRatio?: number;
}

function centerAspectCrop(
  mediaWidth: number,
  mediaHeight: number,
  aspect: number
): Crop {
  return centerCrop(
    makeAspectCrop(
      {
        unit: "%",
        width: 90,
      },
      aspect,
      mediaWidth,
      mediaHeight
    ),
    mediaWidth,
    mediaHeight
  );
}

async function getImageFromSource(source: File | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let objectUrl: string | null = null;

    img.onload = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      resolve(img);
    };
    img.onerror = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      reject(new Error("Failed to load image"));
    };

    if (typeof source === "string") {
      img.src = source;
    } else {
      objectUrl = URL.createObjectURL(source);
      img.src = objectUrl;
    }
  });
}

async function applyCropToCanvas(
  image: HTMLImageElement,
  crop: PixelCrop,
  filename: string,
  sourceMimeType?: string
): Promise<File> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("No 2d context");
  }

  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const pixelRatio = window.devicePixelRatio;

  canvas.width = Math.floor(crop.width * scaleX * pixelRatio);
  canvas.height = Math.floor(crop.height * scaleY * pixelRatio);

  ctx.scale(pixelRatio, pixelRatio);
  ctx.imageSmoothingQuality = "high";

  const cropX = crop.x * scaleX;
  const cropY = crop.y * scaleY;

  ctx.drawImage(
    image,
    cropX,
    cropY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    crop.width * scaleX,
    crop.height * scaleY
  );

  const outputMimeType = getOutputMimeType(sourceMimeType);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to create blob"));
          return;
        }
        const outputFilename = changeExtension(filename, outputMimeType);
        const file = new File([blob], outputFilename, { type: outputMimeType });
        resolve(file);
      },
      outputMimeType,
      0.95
    );
  });
}

function getOutputMimeType(sourceMimeType?: string): string {
  if (sourceMimeType === "image/png") return "image/png";
  if (sourceMimeType === "image/webp") return "image/webp";
  return "image/jpeg";
}

function changeExtension(filename: string, mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  const ext = extensions[mimeType] || ".jpg";
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
  return nameWithoutExt + ext;
}

export function CropDialog({
  open,
  onOpenChange,
  image,
  onConfirm,
  onCancel,
  aspectRatio = 1,
}: CropDialogProps) {
  const [imgSrc, setImgSrc] = useState<string>("");
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [retryKey, setRetryKey] = useState(0);

  const loadImage = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const img = await getImageFromSource(image);
      const reader = new FileReader();
      reader.onload = () => {
        setImgSrc(reader.result as string);
        setIsLoading(false);
      };
      reader.onerror = () => {
        setError("Failed to load image");
        setIsLoading(false);
      };

      if (typeof image === "string") {
        reader.readAsDataURL(await fetch(image).then((r) => r.blob()));
      } else {
        reader.readAsDataURL(image);
      }
    } catch (err) {
      setError("Failed to load image");
      setIsLoading(false);
    }
  }, [image]);

  React.useEffect(() => {
    if (!open) {
      setImgSrc("");
      setCrop(undefined);
      setCompletedCrop(undefined);
      setError(null);
      setRetryKey(0);
      return;
    }

    loadImage();
  }, [open, image, retryKey, loadImage]);

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    if (!imgRef.current) return;
    const { width, height } = e.currentTarget;
    const centeredCrop = centerAspectCrop(width, height, aspectRatio);
    setCrop(centeredCrop);
  }

  const handleConfirm = useCallback(async () => {
    if (!completedCrop || !imgRef.current) return;

    setIsConfirming(true);
    try {
      const sourceMimeType = typeof image === "string" ? undefined : image.type;
      const filename =
        typeof image === "string"
          ? "cropped-image.jpg"
          : image.name.replace(/\.[^/.]+$/, ".jpg");
      const croppedFile = await applyCropToCanvas(
        imgRef.current,
        completedCrop,
        filename,
        sourceMimeType
      );
      onConfirm(croppedFile);
      onOpenChange(false);
    } catch (err) {
      setError("Failed to create cropped image");
    } finally {
      setIsConfirming(false);
    }
  }, [completedCrop, imgRef, image, onConfirm, onOpenChange]);

  const handleCancel = useCallback(() => {
    onCancel();
    onOpenChange(false);
  }, [onCancel, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crop Image</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center min-h-[300px]">
          {isLoading && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Loading image...</span>
            </div>
          )}

          {error && (
            <div className="text-red-500">
              <p>{error}</p>
              <Button
                variant="outline"
                onClick={() => setRetryKey((k) => k + 1)}
                className="mt-2"
              >
                Try Again
              </Button>
            </div>
          )}

          {!isLoading && !error && imgSrc && (
            <div className="w-full max-h-[500px] overflow-hidden">
              <ReactCrop
                crop={crop}
                onChange={(_, percentCrop) => setCrop(percentCrop)}
                onComplete={(c) => setCompletedCrop(c)}
                aspect={aspectRatio}
              >
                <img
                  ref={imgRef}
                  alt="Crop preview"
                  src={imgSrc}
                  onLoad={onImageLoad}
                  className="max-h-[500px] w-auto"
                />
              </ReactCrop>
            </div>
          )}

          {!imgSrc && !isLoading && !error && (
            <p className="text-muted-foreground">No image to crop</p>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={isConfirming}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!completedCrop || !imgRef.current || isConfirming || isLoading}
          >
            {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply Crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}