'use client';

import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import type { InstructorFormData } from "../types";

interface ImagesSectionProps {
  formData: InstructorFormData;
  setFormData: React.Dispatch<React.SetStateAction<InstructorFormData>>;
  removePortfolioImage: (index: number) => void;
  reorderPortfolioImages: (fromIndex: number, toIndex: number) => void;
  movePortfolioImage: (index: number, direction: -1 | 1) => void;
  setActiveTab: (tab: string) => void;
  instructorId: string;
}

export function ImagesSection({
  formData,
  setFormData,
  removePortfolioImage,
  reorderPortfolioImages,
  movePortfolioImage,
  setActiveTab,
  instructorId,
}: ImagesSectionProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const handlePortfolioUpload = (urls: string[]) => {
    setFormData((prev) => ({
      ...prev,
      portfolioImages: [...prev.portfolioImages, ...urls],
    }));
  };

  const handleDragStart = (e: React.DragEvent<HTMLLIElement>, index: number) => {
    setDraggingIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent<HTMLLIElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (index !== dropTargetIndex) setDropTargetIndex(index);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLIElement>, index: number) => {
    if (dropTargetIndex === index) setDropTargetIndex(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLLIElement>, index: number) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain");
    const from = draggingIndex ?? (raw === "" ? null : Number(raw));
    setDraggingIndex(null);
    setDropTargetIndex(null);
    if (from === null || Number.isNaN(from) || from === index) return;
    reorderPortfolioImages(from, index);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDropTargetIndex(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Images</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ImageUploadField
          label="Profile Picture"
          value={formData.profileImageUrl}
          onChange={(url) => setFormData((prev) => ({ ...prev, profileImageUrl: url, profileImageUploadPath: "" }))}
          onUploadComplete={(_url, path) => setFormData((prev) => ({ ...prev, profileImageUploadPath: path }))}
          instructorId={instructorId}
          type="profile"
          enableCrop
        />
        <div>
          <Label>Portfolio Images</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Drag images to reorder, or use the arrow buttons. The first image is shown first on the public profile page.
          </p>
          <div className="mt-2">
            <ImageUploadField
              instructorId={instructorId}
              type="portfolio"
              multiple
              maxFiles={10}
              onChange={() => {}}
              onMultipleUpload={handlePortfolioUpload}
              placeholder="Enter image URL or drag & drop to upload"
              compress
              compressionOptions={{
                maxSizeMB: 3.5,
                maxWidthOrHeight: 2400,
                initialQuality: 0.9,
              }}
            />
          </div>
          {formData.portfolioImages.length > 0 && (
            <ul className="grid grid-cols-4 gap-2 mt-4">
              {formData.portfolioImages.map((url, i) => {
                const isDragging = draggingIndex === i;
                const isDropTarget = dropTargetIndex === i && draggingIndex !== null && draggingIndex !== i;
                return (
                  <li
                    key={`${url}-${i}`}
                    className={`relative group h-24 rounded outline-none transition-all ${
                      isDragging ? "opacity-50" : ""
                    } ${isDropTarget ? "ring-2 ring-primary" : ""}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragLeave={(e) => handleDragLeave(e, i)}
                    onDrop={(e) => handleDrop(e, i)}
                    onDragEnd={handleDragEnd}
                    aria-label={`Portfolio image ${i + 1} of ${formData.portfolioImages.length}`}
                  >
                    <span
                      className="absolute top-1 left-1 z-10 bg-background/90 text-foreground rounded p-1 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      title="Drag to reorder"
                      aria-hidden
                    >
                      <GripVertical className="h-3 w-3" />
                    </span>
                    <span className="absolute top-1 left-7 z-10 bg-background/90 text-foreground text-[10px] font-medium rounded px-1.5 py-0.5">
                      #{i + 1}
                    </span>
                    <Image
                      src={url}
                      alt={`Portfolio ${i + 1}`}
                      fill
                      sizes="(max-width: 768px) 25vw, 15vw"
                      unoptimized
                      className="object-cover rounded"
                      draggable={false}
                    />
                    <div className="absolute bottom-1 right-1 z-10 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => movePortfolioImage(i, -1)}
                        disabled={i === 0}
                        className="bg-background/90 text-foreground rounded p-1 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background"
                        aria-label={`Move portfolio image ${i + 1} earlier`}
                        title="Move earlier"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePortfolioImage(i, 1)}
                        disabled={i === formData.portfolioImages.length - 1}
                        className="bg-background/90 text-foreground rounded p-1 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background"
                        aria-label={`Move portfolio image ${i + 1} later`}
                        title="Move later"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removePortfolioImage(i)}
                        className="bg-destructive text-destructive-foreground rounded p-1 hover:bg-destructive/90"
                        aria-label={`Remove portfolio image ${i + 1}`}
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setActiveTab("basic")}>Back</Button>
          <Button onClick={() => setActiveTab("tags")}>Next</Button>
        </div>
      </CardContent>
    </Card>
  );
}
