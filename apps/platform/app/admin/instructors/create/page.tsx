"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Upload } from "lucide-react";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export default function CreateInstructorPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    email: "",
    tagline: "",
    bio: "",
    oneOnOneInventory: "3",
    groupInventory: "2",
    maxActiveStudents: "10",
  });
  const [profileImage, setProfileImage] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleNameChange = (name: string) => {
    setFormData((prev) => ({
      ...prev,
      name,
      slug: generateSlug(name),
    }));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setUploadError(null);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Only image files are supported.");
      return;
    }
    setProfileImage(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // 1) Create instructor via platform API (enforces admin & validation)
      const createRes = await fetch("/api/admin/instructors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          slug: formData.slug,
          email: formData.email || undefined,
          tagline: formData.tagline || undefined,
          bio: formData.bio || undefined,
          oneOnOneInventory: (() => { const v = parseInt(formData.oneOnOneInventory); return Number.isNaN(v) ? 3 : v; })(),
          groupInventory: (() => { const v = parseInt(formData.groupInventory); return Number.isNaN(v) ? 2 : v; })(),
          maxActiveStudents: (() => { const v = parseInt(formData.maxActiveStudents); return Number.isNaN(v) ? 10 : v; })(),
          isActive: true,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to create instructor");
      }
      const created = await createRes.json();
      // Validate response shape minimally to avoid undefined access
      const instructorId: string | undefined =
        created && created.instructor && typeof created.instructor.id === "string"
          ? created.instructor.id
          : undefined;
      if (!instructorId) {
        throw new Error("Instructor created but no id returned");
      }

      // 2) If a profile image is provided, upload it via admin upload API
      if (profileImage) {
        const form = new FormData();
        form.append("file", profileImage);
        form.append("instructorId", instructorId);
        form.append("type", "profile");

        const uploadRes = await fetch("/api/admin/instructors/upload", {
          method: "POST",
          body: form,
        });
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}));
          console.error("Profile image upload failed:", err);
          // Non-fatal: instructor exists; let user proceed and fix image later
        }
      }

      router.push("/admin/instructors");
    } catch (error) {
      console.error("Error creating instructor:", error);
      const message = error instanceof Error ? error.message : "Failed to create instructor";
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Create Instructor</h1>
        <p className="text-muted-foreground mt-2">
          Add a new instructor to the platform
        </p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Instructor name"
                required
              />
            </div>

            <div>
              <Label htmlFor="slug">Slug *</Label>
              <Input
                id="slug"
                value={formData.slug}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, slug: e.target.value }))
                }
                placeholder="instructor-slug"
                required
              />
              <p className="text-sm text-muted-foreground mt-1">
                URL-friendly identifier: /instructors/{formData.slug || "slug"}
              </p>
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="instructor@example.com"
              />
            </div>

            <div>
              <Label htmlFor="tagline">Tagline</Label>
              <Input
                id="tagline"
                value={formData.tagline}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, tagline: e.target.value }))
                }
                placeholder="Short professional tagline"
              />
            </div>

            <div>
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={formData.bio}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, bio: e.target.value }))
                }
                placeholder="Full bio description"
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile Image</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30"}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  setUploadError(null);
                  setProfileImage(e.target.files?.[0] || null);
                }}
                className="hidden"
                id="profile-image-upload"
              />
              <label
                htmlFor="profile-image-upload"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {profileImage ? profileImage.name : "Drag & drop or click to select a profile image"}
                </span>
              </label>
              {uploadError && (
                <p className="mt-2 text-sm text-red-500">{uploadError}</p>
              )}
              {profileImage && (
                <p className="mt-2 text-sm text-green-600">
                  Selected: {profileImage.name}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inventory Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="oneOnOneInventory">1-on-1 Inventory</Label>
                <Input
                  id="oneOnOneInventory"
                  type="number"
                  min="0"
                  value={formData.oneOnOneInventory}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      oneOnOneInventory: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="groupInventory">Group Inventory</Label>
                <Input
                  id="groupInventory"
                  type="number"
                  min="0"
                  value={formData.groupInventory}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      groupInventory: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="maxActiveStudents">Max Active Students</Label>
                <Input
                  id="maxActiveStudents"
                  type="number"
                  min="1"
                  value={formData.maxActiveStudents}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      maxActiveStudents: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/admin/instructors")}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Instructor
          </Button>
        </div>
      </form>
    </div>
  );
}
