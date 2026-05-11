"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "@/convex/_generated/dataModel";
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

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL || "");

  const handleNameChange = (name: string) => {
    setFormData((prev) => ({
      ...prev,
      name,
      slug: generateSlug(name),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      let profileImageUrl: string | undefined;
      let profileImageStorageId: string | undefined;

      if (profileImage) {
        const storageId = await convex.mutation("storage:store" as any, {
          body: await profileImage.arrayBuffer(),
          contentType: profileImage.type,
        });

        const url = await convex.mutation("admin:uploadInstructorProfileImage" as any, {
          instructorId: "temp" as Id<"instructors">, 
          storageId,
        });

        profileImageStorageId = storageId;
      }

      const instructorId = await convex.mutation("admin:createInstructor" as any, {
        name: formData.name,
        slug: formData.slug,
        email: formData.email || undefined,
        tagline: formData.tagline || undefined,
        bio: formData.bio || undefined,
        oneOnOneInventory: parseInt(formData.oneOnOneInventory) || 3,
        groupInventory: parseInt(formData.groupInventory) || 2,
        maxActiveStudents: parseInt(formData.maxActiveStudents) || 10,
        profileImageUrl,
        profileImageStorageId,
        isActive: true,
      });

      router.push("/admin/instructors");
    } catch (error) {
      console.error("Error creating instructor:", error);
      alert("Failed to create instructor");
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
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setProfileImage(e.target.files?.[0] || null)}
                className="hidden"
                id="profile-image-upload"
              />
              <label
                htmlFor="profile-image-upload"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {profileImage ? profileImage.name : "Click to upload profile image"}
                </span>
              </label>
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