"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Plus, X, Check } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";

type Socials = {
  twitter?: string;
  instagram?: string;
  youtube?: string;
  bluesky?: string;
  website?: string;
  artstation?: string;
};

type InstructorFormData = {
  name: string;
  slug: string;
  email: string;
  tagline: string;
  bio: string;
  specialties: string[];
  background: string[];
  profileImageUrl: string;
  portfolioImages: string[];
  socials: Socials;
  isActive: boolean;
};

const SPECIALTY_OPTIONS = [
  "Concept Art", "Character Design", "Environment Art", "Illustration", 
  "UI Art", "UI/UX Design", "Graphic Design", "Motion Design", "Animation",
  "3D Modeling", "Texturing", "Rigging", "Game Development", "Prop Design",
  "Armor Design", "Weaponry", "World-building", "Pixel Art", "Traditional Art",
  "Oil Painting", "Watercolor", "Digital Painting", "Painterly Style", 
  "Self-Taught Journey", "Freelance", "Contract Work"
];

const BACKGROUND_OPTIONS = [
  "Gaming", "Indie", "TV", "Film", "Studio", "Freelance", 
  "Agency", "Art Director", "Lead Artist", "Solo Dev", "Contracting"
];

const SOCIAL_PLATFORMS = [
  { key: "twitter", label: "Twitter/X", placeholder: "https://twitter.com/username" },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/username" },
  { key: "youtube", label: "YouTube", placeholder: "https://youtube.com/@username" },
  { key: "bluesky", label: "Bluesky", placeholder: "https://bsky.app/profile/username" },
  { key: "website", label: "Website", placeholder: "https://example.com" },
  { key: "artstation", label: "ArtStation", placeholder: "https://artstation.com/username" },
];

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
  const [activeTab, setActiveTab] = useState("basic");
  const [formData, setFormData] = useState<InstructorFormData>({
    name: "",
    slug: "",
    email: "",
    tagline: "",
    bio: "",
    specialties: [],
    background: [],
    profileImageUrl: "",
    portfolioImages: [],
    socials: {},
    isActive: true,
  });
  const [customSpecialty, setCustomSpecialty] = useState("");
  const [customBackground, setCustomBackground] = useState("");
  const [portfolioInput, setPortfolioInput] = useState("");

  const createMutation = useMutation({
    mutationFn: async (data: InstructorFormData) => {
      const response = await fetch("/api/admin/instructors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create instructor");
      }
      return response.json();
    },
    onSuccess: (data) => {
      router.push(`/admin/instructors/${data.instructor.id}/edit`);
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to create instructor");
    },
  });

  const handleNameChange = (name: string) => {
    setFormData((prev) => ({
      ...prev,
      name,
      slug: prev.slug || generateSlug(name),
    }));
  };

  const toggleTag = (field: "specialties" | "background", value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((v) => v !== value)
        : [...prev[field], value],
    }));
  };

  const addCustomTag = (field: "specialties" | "background", value: string, setValue: React.Dispatch<React.SetStateAction<string>>) => {
    if (!value.trim()) return;
    if (!formData[field].includes(value.trim())) {
      setFormData((prev) => ({
        ...prev,
        [field]: [...prev[field], value.trim()],
      }));
    }
    setValue("");
  };

  const addPortfolioImage = () => {
    if (!portfolioInput.trim()) return;
    if (!formData.portfolioImages.includes(portfolioInput.trim())) {
      setFormData((prev) => ({
        ...prev,
        portfolioImages: [...prev.portfolioImages, portfolioInput.trim()],
      }));
    }
    setPortfolioInput("");
  };

  const removePortfolioImage = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      portfolioImages: prev.portfolioImages.filter((_, i) => i !== index),
    }));
  };

  const updateSocial = (key: keyof Socials, value: string) => {
    setFormData((prev) => ({
      ...prev,
      socials: { ...prev.socials, [key]: value || undefined },
    }));
  };

  const handleSubmit = () => {
    createMutation.mutate(formData);
  };

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/instructors">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Add Instructor</h1>
          <p className="text-muted-foreground mt-1">Create a new instructor profile</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="social">Social Links</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>Enter the instructor&apos;s basic details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
              <div>
                <Label htmlFor="slug">Slug *</Label>
                <Input
                  id="slug"
                  value={formData.slug}
                  onChange={(e) => setFormData((prev) => ({ ...prev, slug: e.target.value }))}
                  placeholder="john-doe"
                />
                <p className="text-sm text-muted-foreground mt-1">URL: /instructors/{formData.slug || "..."}</p>
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="instructor@example.com"
                />
                <p className="text-sm text-muted-foreground mt-1">Send a Clerk invitation to this email</p>
              </div>
              <div>
                <Label htmlFor="tagline">Tagline</Label>
                <Input
                  id="tagline"
                  value={formData.tagline}
                  onChange={(e) => setFormData((prev) => ({ ...prev, tagline: e.target.value }))}
                  placeholder="Expert character artist with 10+ years experience"
                />
              </div>
              <div>
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={formData.bio}
                  onChange={(e) => setFormData((prev) => ({ ...prev, bio: e.target.value }))}
                  placeholder="Write a detailed bio..."
                  rows={6}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="isActive" className="cursor-pointer">Active</Label>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setActiveTab("images")}>Next</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="images">
          <Card>
            <CardHeader>
              <CardTitle>Images</CardTitle>
              <CardDescription>Add profile picture and portfolio images</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="profileImageUrl">Profile Picture URL</Label>
                <Input
                  id="profileImageUrl"
                  value={formData.profileImageUrl}
                  onChange={(e) => setFormData((prev) => ({ ...prev, profileImageUrl: e.target.value }))}
                  placeholder="https://example.com/profile.jpg"
                />
                {formData.profileImageUrl && (
                  <div className="mt-2 relative w-32 h-32 rounded-lg overflow-hidden border">
                    <img 
                      src={formData.profileImageUrl} 
                      alt="Profile preview" 
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}
              </div>
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
                      <div key={i} className="relative group">
                        <img src={url} alt={`Portfolio ${i + 1}`} className="w-full h-24 object-cover rounded" />
                        <button
                          onClick={() => removePortfolioImage(i)}
                          className="absolute top-1 right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
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
        </TabsContent>

        <TabsContent value="tags">
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
              <CardDescription>Select specialties and background</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label>Specialties</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {SPECIALTY_OPTIONS.map((specialty) => (
                    <Badge
                      key={specialty}
                      variant={formData.specialties.includes(specialty) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleTag("specialties", specialty)}
                    >
                      {specialty}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2 mt-4">
                  <Input
                    value={customSpecialty}
                    onChange={(e) => setCustomSpecialty(e.target.value)}
                    placeholder="Add custom specialty"
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomTag("specialties", customSpecialty, setCustomSpecialty))}
                  />
                  <Button type="button" onClick={() => addCustomTag("specialties", customSpecialty, setCustomSpecialty)} variant="secondary">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {formData.specialties.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {formData.specialties.map((s) => (
                      <Badge key={s} variant="secondary" className="cursor-pointer" onClick={() => toggleTag("specialties", s)}>
                        {s} <X className="ml-1 h-3 w-3" />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Label>Background</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {BACKGROUND_OPTIONS.map((bg) => (
                    <Badge
                      key={bg}
                      variant={formData.background.includes(bg) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleTag("background", bg)}
                    >
                      {bg}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2 mt-4">
                  <Input
                    value={customBackground}
                    onChange={(e) => setCustomBackground(e.target.value)}
                    placeholder="Add custom background"
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomTag("background", customBackground, setCustomBackground))}
                  />
                  <Button type="button" onClick={() => addCustomTag("background", customBackground, setCustomBackground)} variant="secondary">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {formData.background.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {formData.background.map((b) => (
                      <Badge key={b} variant="secondary" className="cursor-pointer" onClick={() => toggleTag("background", b)}>
                        {b} <X className="ml-1 h-3 w-3" />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setActiveTab("images")}>Back</Button>
                <Button onClick={() => setActiveTab("social")}>Next</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="social">
          <Card>
            <CardHeader>
              <CardTitle>Social Links</CardTitle>
              <CardDescription>Add social media links</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {SOCIAL_PLATFORMS.map(({ key, label, placeholder }) => (
                <div key={key}>
                  <Label htmlFor={key}>{label}</Label>
                  <Input
                    id={key}
                    value={formData.socials[key as keyof Socials] || ""}
                    onChange={(e) => updateSocial(key as keyof Socials, e.target.value)}
                    placeholder={placeholder}
                  />
                </div>
              ))}
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setActiveTab("tags")}>Back</Button>
                <Button onClick={() => setActiveTab("review")}>Next</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review">
          <Card>
            <CardHeader>
              <CardTitle>Review</CardTitle>
              <CardDescription>Review and create the instructor</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Name</Label>
                  <p className="text-lg font-medium">{formData.name || "-"}</p>
                </div>
                <div>
                  <Label>Slug</Label>
                  <p className="text-lg font-mono">{formData.slug || "-"}</p>
                </div>
                <div className="col-span-2">
                  <Label>Tagline</Label>
                  <p>{formData.tagline || "-"}</p>
                </div>
                <div className="col-span-2">
                  <Label>Bio</Label>
                  <p className="whitespace-pre-wrap">{formData.bio || "-"}</p>
                </div>
                <div>
                  <Label>Specialties</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {formData.specialties.map((s) => (
                      <Badge key={s} variant="secondary">{s}</Badge>
                    ))}
                    {formData.specialties.length === 0 && "-"}
                  </div>
                </div>
                <div>
                  <Label>Background</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {formData.background.map((b) => (
                      <Badge key={b} variant="secondary">{b}</Badge>
                    ))}
                    {formData.background.length === 0 && "-"}
                  </div>
                </div>
                <div>
                  <Label>Status</Label>
                  <p>{formData.isActive ? "Active" : "Inactive"}</p>
                </div>
              </div>
              
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setActiveTab("social")}>Back</Button>
                <Button 
                  onClick={handleSubmit} 
                  disabled={createMutation.isPending || !formData.name || !formData.slug}
                >
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Instructor
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
