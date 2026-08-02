'use client';

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, X } from "lucide-react";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import type { InstructorFormData } from "../types";

interface ImagesSectionProps {
  formData: InstructorFormData;
  setFormData: React.Dispatch<React.SetStateAction<InstructorFormData>>;
  portfolioInput: string;
  setPortfolioInput: (value: string) => void;
  addPortfolioImage: () => void;
  removePortfolioImage: (index: number) => void;
  setActiveTab: (tab: string) => void;
  instructorId: string;
}

export function ImagesSection({
  formData,
  setFormData,
  portfolioInput,
  setPortfolioInput,
  addPortfolioImage,
  removePortfolioImage,
  setActiveTab,
  instructorId,
}: ImagesSectionProps) {
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
          <div className="flex gap-2 mt-2">
            <Input
              value={portfolioInput}
              onChange={(e) => setPortfolioInput(e.target.value)}
              placeholder="https://example.com/portfolio/1.jpg"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPortfolioImage())}
            />
            <Button type="button" onClick={addPortfolioImage} variant="secondary">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {formData.portfolioImages.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mt-4">
              {formData.portfolioImages.map((url, i) => (
                <div key={i} className="relative group h-24">
                  <Image
                    src={url}
                    alt={`Portfolio ${i + 1}`}
                    fill
                    sizes="(max-width: 768px) 25vw, 15vw"
                    unoptimized
                    className="object-cover rounded"
                  />
                  <button
                    onClick={() => removePortfolioImage(i)}
                    className="absolute top-1 right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
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
