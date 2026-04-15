"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ArrowLeft, Plus, X, Trash2, Upload } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";
import { ImageUploadField } from "@/components/admin/image-upload-field";

type Socials = {
  twitter?: string;
  instagram?: string;
  youtube?: string;
  bluesky?: string;
  website?: string;
  artstation?: string;
};

type Testimonial = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
};

type MenteeResult = {
  id: string;
  imageUrl: string | null;
  imageUploadPath: string | null;
  studentName: string | null;
  createdAt: string;
};

type InstructorFormData = {
  name: string;
  slug: string;
  tagline: string;
  bio: string;
  specialties: string[];
  background: string[];
  profileImageUrl: string;
  portfolioImages: string[];
  socials: Socials;
  isActive: boolean;
  userId: string | null;
};

type InstructorDetail = InstructorFormData & {
  testimonials: Testimonial[];
  menteeResults: MenteeResult[];
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

async function fetchInstructor(id: string): Promise<InstructorDetail> {
  return apiFetch<InstructorDetail>(`/api/admin/instructors/${id}`);
}

async function updateInstructor(id: string, data: Partial<InstructorFormData>) {
  const response = await fetch(`/api/admin/instructors/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update instructor");
  }
  return response.json();
}

async function addTestimonial(instructorId: string, data: { name: string; text: string }) {
  const response = await fetch(`/api/admin/instructors/${instructorId}/testimonials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to add testimonial");
  }
  return response.json();
}

async function deleteTestimonial(instructorId: string, testimonialId: string) {
  const response = await fetch(`/api/admin/instructors/${instructorId}/testimonials/${testimonialId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete testimonial");
  }
  return response.json();
}

async function addMenteeResult(instructorId: string, data: { imageUrl: string; studentName: string }) {
  const response = await fetch(`/api/admin/instructors/${instructorId}/mentee-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to add mentee result");
  }
  return response.json();
}

async function deleteMenteeResult(instructorId: string, resultId: string) {
  const response = await fetch(`/api/admin/instructors/${instructorId}/mentee-results/${resultId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete mentee result");
  }
  return response.json();
}

export default function EditInstructorPage() {
  const router = useRouter();
  const params = useParams();
  const instructorId = params.id as string;
  
  const [activeTab, setActiveTab] = useState("basic");
  const [formData, setFormData] = useState<InstructorFormData>({
    name: "",
    slug: "",
    tagline: "",
    bio: "",
    specialties: [],
    background: [],
    profileImageUrl: "",
    portfolioImages: [],
    socials: {},
    isActive: true,
    userId: null,
  });
  const [customSpecialty, setCustomSpecialty] = useState("");
  const [customBackground, setCustomBackground] = useState("");
  const [portfolioInput, setPortfolioInput] = useState("");
  
  // Testimonial dialog
  const [showTestimonialDialog, setShowTestimonialDialog] = useState(false);
  const [testimonialForm, setTestimonialForm] = useState({ name: "", text: "" });
  
  // Mentee result dialog
  const [showMenteeResultDialog, setShowMenteeResultDialog] = useState(false);
  const [menteeResultForm, setMenteeResultForm] = useState({ imageUrl: "", studentName: "" });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["instructor", instructorId],
    queryFn: () => fetchInstructor(instructorId),
    enabled: !!instructorId,
  });

  useEffect(() => {
    if (data) {
      setFormData({
        name: data.name || "",
        slug: data.slug || "",
        tagline: data.tagline || "",
        bio: data.bio || "",
        specialties: data.specialties || [],
        background: data.background || [],
        profileImageUrl: data.profileImageUrl || "",
        portfolioImages: data.portfolioImages || [],
        socials: data.socials || {},
        isActive: data.isActive ?? true,
        userId: data.userId || null,
      });
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<InstructorFormData>) => updateInstructor(instructorId, data),
    onSuccess: () => {
      refetch();
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to update instructor");
    },
  });

  const addTestimonialMutation = useMutation({
    mutationFn: (data: { name: string; text: string }) => addTestimonial(instructorId, data),
    onSuccess: () => {
      setShowTestimonialDialog(false);
      setTestimonialForm({ name: "", text: "" });
      refetch();
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to add testimonial");
    },
  });

  const deleteTestimonialMutation = useMutation({
    mutationFn: (testimonialId: string) => deleteTestimonial(instructorId, testimonialId),
    onSuccess: () => refetch(),
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to delete testimonial");
    },
  });

  const addMenteeResultMutation = useMutation({
    mutationFn: (data: { imageUrl: string; studentName: string }) => addMenteeResult(instructorId, data),
    onSuccess: () => {
      setShowMenteeResultDialog(false);
      setMenteeResultForm({ imageUrl: "", studentName: "" });
      refetch();
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to add mentee result");
    },
  });

  const deleteMenteeResultMutation = useMutation({
    mutationFn: (resultId: string) => deleteMenteeResult(instructorId, resultId),
    onSuccess: () => refetch(),
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to delete mentee result");
    },
  });

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

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container mx-auto py-8">
        <p>Instructor not found.</p>
        <Link href="/admin/instructors">
          <Button variant="link">Back to Instructors</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/instructors">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Edit Instructor</h1>
            <p className="text-muted-foreground mt-1">/instructors/{formData.slug}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleSave} 
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="social">Social Links</TabsTrigger>
          <TabsTrigger value="testimonials">Testimonials</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
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
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="slug">Slug *</Label>
                <Input
                  id="slug"
                  value={formData.slug}
                  onChange={(e) => setFormData((prev) => ({ ...prev, slug: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="tagline">Tagline</Label>
                <Input
                  id="tagline"
                  value={formData.tagline}
                  onChange={(e) => setFormData((prev) => ({ ...prev, tagline: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={formData.bio}
                  onChange={(e) => setFormData((prev) => ({ ...prev, bio: e.target.value }))}
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
            </CardHeader>
            <CardContent className="space-y-4">
              <ImageUploadField
                label="Profile Picture"
                value={formData.profileImageUrl}
                onChange={(url) => setFormData((prev) => ({ ...prev, profileImageUrl: url }))}
                instructorId={instructorId}
                type="profile"
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
                      <div key={i} className="relative group">
                        <img src={url} alt={`Portfolio ${i + 1}`} className="w-full h-24 object-cover rounded" />
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
        </TabsContent>

        <TabsContent value="tags">
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
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
                <Button onClick={() => setActiveTab("testimonials")}>Next</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="testimonials">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Testimonials</CardTitle>
                  <CardDescription>Manage testimonials for this instructor</CardDescription>
                </div>
                <Button onClick={() => setShowTestimonialDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Testimonial
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {data.testimonials.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No testimonials yet</p>
              ) : (
                <div className="space-y-4">
                  {data.testimonials.map((t) => (
                    <div key={t.id} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">{t.name}</p>
                          <p className="text-sm text-muted-foreground mt-1">{t.text}</p>
                          <p className="text-xs text-muted-foreground mt-2">
                            {new Date(t.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteTestimonialMutation.mutate(t.id)}
                          disabled={deleteTestimonialMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between mt-4">
                <Button variant="outline" onClick={() => setActiveTab("social")}>Back</Button>
                <Button onClick={() => setActiveTab("results")}>Next</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="results">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Mentee Results</CardTitle>
                  <CardDescription>Before/after images from mentees</CardDescription>
                </div>
                <Button onClick={() => setShowMenteeResultDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Result
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {data.menteeResults.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No mentee results yet</p>
              ) : (
                <div className="grid grid-cols-4 gap-4">
                  {data.menteeResults.map((r) => (
                    <div key={r.id} className="relative group">
                      {r.imageUrl && (
                        <img src={r.imageUrl} alt="Mentee result" className="w-full h-32 object-cover rounded" />
                      )}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteMenteeResultMutation.mutate(r.id)}
                          disabled={deleteMenteeResultMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {r.studentName && (
                        <p className="text-xs text-center mt-1">{r.studentName}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between mt-4">
                <Button variant="outline" onClick={() => setActiveTab("testimonials")}>Back</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Testimonial Dialog */}
      <Dialog open={showTestimonialDialog} onOpenChange={setShowTestimonialDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Testimonial</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={testimonialForm.name}
                onChange={(e) => setTestimonialForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Student name"
              />
            </div>
            <div>
              <Label>Testimonial</Label>
              <Textarea
                value={testimonialForm.text}
                onChange={(e) => setTestimonialForm((prev) => ({ ...prev, text: e.target.value }))}
                placeholder="What they said..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTestimonialDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => addTestimonialMutation.mutate(testimonialForm)}
              disabled={!testimonialForm.name || !testimonialForm.text || addTestimonialMutation.isPending}
            >
              {addTestimonialMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mentee Result Dialog */}
      <Dialog open={showMenteeResultDialog} onOpenChange={setShowMenteeResultDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Mentee Result</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <ImageUploadField
              label="Result Image"
              value={menteeResultForm.imageUrl}
              onChange={(url) => setMenteeResultForm((prev) => ({ ...prev, imageUrl: url }))}
              instructorId={instructorId}
              type="result"
            />
            <div>
              <Label>Student Name (optional)</Label>
              <Input
                value={menteeResultForm.studentName}
                onChange={(e) => setMenteeResultForm((prev) => ({ ...prev, studentName: e.target.value }))}
                placeholder="Student name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMenteeResultDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => addMenteeResultMutation.mutate(menteeResultForm)}
              disabled={!menteeResultForm.imageUrl || addMenteeResultMutation.isPending}
            >
              {addMenteeResultMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
