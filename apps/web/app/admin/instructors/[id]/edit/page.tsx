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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, Plus, X, Trash2, Upload } from "lucide-react";
import { z } from "zod";
import { apiFetch } from "@/lib/queries/api-client";
import { ImageUploadField } from "@/components/admin/image-upload-field";

const NONE_SENTINEL = "__none__";

class ApiError extends Error {
  response?: Record<string, unknown>;
  status?: number;
  
  constructor(message: string, response?: Record<string, unknown>, status?: number) {
    super(message);
    this.name = "ApiError";
    this.response = response;
    this.status = status;
  }
}

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
  email: string;
  tagline: string;
  bio: string;
  specialties: string[];
  background: string[];
  profileImageUrl: string;
  portfolioImages: string[];
  socials: Socials;
  isActive: boolean;
  userId: string | null;
  mentorId: string | null;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
};

type ActiveProduct = {
  id: string;
  title: string;
  stripeProductId: string | null;
  stripePriceId: string | null;
};

type InstructorDetail = InstructorFormData & {
  testimonials: Testimonial[];
  menteeResults: MenteeResult[];
};

type UpdateInstructorResponse = {
  success: boolean;
  message: string;
  productsDeactivated?: {
    stripeSuccess: string[];
    stripeFailed: { id: string; error: string }[];
  };
  instructor?: {
    id: string;
    name: string;
    slug: string;
    tagline: string | null;
    bio: string | null;
    specialties: string[];
    background: string[];
    profileImageUrl: string | null;
    portfolioImages: string[];
    socials: Socials | null;
    isActive: boolean;
    userId: string | null;
    mentorId: string | null;
    updatedAt: string;
  };
};

const updateInstructorResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  productsDeactivated: z.object({
    stripeSuccess: z.array(z.string()),
    stripeFailed: z.array(z.object({ id: z.string(), error: z.string() })),
  }).optional(),
  instructor: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    tagline: z.string().nullable(),
    bio: z.string().nullable(),
    specialties: z.array(z.string()),
    background: z.array(z.string()),
    profileImageUrl: z.string().nullable(),
    portfolioImages: z.array(z.string()),
    socials: z.record(z.string(), z.string().optional()).nullable(),
    isActive: z.boolean(),
    userId: z.string().nullable(),
    mentorId: z.string().nullable(),
    updatedAt: z.string(),
  }).optional(),
});

const mentorsResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    email: z.string().nullable(),
  })),
});

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

/**
 * Fetches instructor details by ID including testimonials and mentee results.
 */
async function fetchInstructor(id: string): Promise<InstructorDetail> {
  return apiFetch<InstructorDetail>(`/api/admin/instructors/${id}`);
}

/**
 * Updates an instructor with the given data.
 * @param id - The instructor ID
 * @param data - Partial form data to update
 * @param deactivateProducts - Whether to deactivate associated Stripe products
 */
async function updateInstructor(
  id: string,
  data: Partial<InstructorFormData>,
  deactivateProducts: boolean = false
): Promise<UpdateInstructorResponse> {
  const payload = {
    ...data,
    deactivateProducts,
  };

  const response = await fetch(`/api/admin/instructors/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new ApiError(
      result.error || "Failed to update instructor",
      result,
      response.status
    );
  }

  return updateInstructorResponseSchema.parse(result);
}

/**
 * Adds a testimonial to an instructor.
 */
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

/**
 * Deletes a testimonial from an instructor.
 */
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

/**
 * Adds a mentee result (before/after image) to an instructor.
 */
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

/**
 * Deletes a mentee result from an instructor.
 */
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
    email: "",
    tagline: "",
    bio: "",
    specialties: [],
    background: [],
    profileImageUrl: "",
    portfolioImages: [],
    socials: {},
    isActive: true,
    userId: null,
    mentorId: null,
    oneOnOneInventory: 0,
    groupInventory: 0,
    maxActiveStudents: 10,
  });
  const [customSpecialty, setCustomSpecialty] = useState("");
  const [customBackground, setCustomBackground] = useState("");
  const [portfolioInput, setPortfolioInput] = useState("");

  const [showTestimonialDialog, setShowTestimonialDialog] = useState(false);
  const [testimonialForm, setTestimonialForm] = useState({ name: "", text: "" });

  const [showMenteeResultDialog, setShowMenteeResultDialog] = useState(false);
  const [menteeResultForm, setMenteeResultForm] = useState({ imageUrl: "", studentName: "" });

  const [showProductDeactivationDialog, setShowProductDeactivationDialog] = useState(false);
  const [activeProducts, setActiveProducts] = useState<ActiveProduct[]>([]);

  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [deactivationResults, setDeactivationResults] = useState<{
    stripeSuccess: string[];
    stripeFailed: { id: string; error: string }[];
  } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["instructor", instructorId],
    queryFn: () => fetchInstructor(instructorId),
    enabled: !!instructorId,
  });

  const { data: mentorsData } = useQuery({
    queryKey: ["mentors"],
    queryFn: async () => {
      const result = await apiFetch<{ items: { id: string; email: string | null }[] }>("/api/admin/mentors");
      return mentorsResponseSchema.parse(result);
    },
  });

  useEffect(() => {
    if (data) {
      setFormData({
        name: data.name || "",
        slug: data.slug || "",
        email: data.email || "",
        tagline: data.tagline || "",
        bio: data.bio || "",
        specialties: data.specialties || [],
        background: data.background || [],
        profileImageUrl: data.profileImageUrl || "",
        portfolioImages: data.portfolioImages || [],
        socials: data.socials || {},
        isActive: data.isActive ?? true,
        userId: data.userId || null,
        mentorId: data.mentorId || null,
        oneOnOneInventory: (data as any).oneOnOneInventory ?? 0,
        groupInventory: (data as any).groupInventory ?? 0,
        maxActiveStudents: (data as any).maxActiveStudents ?? 10,
      });
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: ({ data, deactivateProducts }: { data: Partial<InstructorFormData>; deactivateProducts: boolean }) =>
      updateInstructor(instructorId, data, deactivateProducts),
    onSuccess: (result) => {
      if (result.productsDeactivated) {
        setDeactivationResults(result.productsDeactivated);
        setSuccessMessage(
          result.productsDeactivated.stripeFailed.length > 0
            ? "Instructor deactivated, but some products failed to deactivate on Stripe."
            : "Instructor and all products have been deactivated on Stripe."
        );
        setShowSuccessDialog(true);
      } else {
        setSuccessMessage("Instructor updated successfully");
        setDeactivationResults(null);
        setShowSuccessDialog(true);
      }
      refetch();
    },
    onError: (error: Error) => {
      const apiError = error as ApiError;
      const response = apiError.response;
      if (response?.requiresProductDeactivation) {
        setActiveProducts((response.activeProducts as ActiveProduct[]) || []);
        setShowProductDeactivationDialog(true);
      } else if (response?.activeMenteeCount) {
        alert(`Cannot deactivate instructor: ${response.activeMenteeCount} active mentee(s) with remaining sessions.`);
      } else {
        alert(error.message || "Failed to update instructor");
      }
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      data: {
        ...formData,
        // Include inventory fields (were in formData but not being sent)
        oneOnOneInventory: formData.oneOnOneInventory,
        groupInventory: formData.groupInventory,
        maxActiveStudents: formData.maxActiveStudents,
      },
      deactivateProducts: false,
    });
  };

  const handleDeactivateWithProducts = () => {
    setShowProductDeactivationDialog(false);
    updateMutation.mutate({ data: { ...formData, isActive: false }, deactivateProducts: true });
  };

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
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="social">Social Links</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
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
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <div>
                  <Label htmlFor="email">Email (for Clerk Invitation)</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="instructor@example.com"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Clerk Status:</span>
                  {formData.userId ? (
                    <Badge variant="default" className="bg-green-600">
                      Connected
                    </Badge>
                  ) : formData.email ? (
                    <Badge variant="outline">Not Connected</Badge>
                  ) : (
                    <Badge variant="secondary">No Email</Badge>
                  )}
                </div>
                {formData.userId && (
                  <p className="text-xs text-muted-foreground">Clerk User ID: {formData.userId}</p>
                )}
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
              <div>
                <Label htmlFor="mentorId">Booking record</Label>
                <Select
                  value={formData.mentorId ?? NONE_SENTINEL}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, mentorId: value === NONE_SENTINEL ? null : value }))}
                >
                  <SelectTrigger id="mentorId">
                    <SelectValue placeholder="Select a booking record" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_SENTINEL}>None</SelectItem>
                    {mentorsData?.items?.map((mentor) => (
                      <SelectItem key={mentor.id} value={mentor.id}>
                        {mentor.email || mentor.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle>Inventory & Bookings</CardTitle>
              <CardDescription>Configure mentorship availability and booking settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {formData.mentorId ? (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="oneOnOneInventory">One-on-One Inventory</Label>
                    <Input
                      id="oneOnOneInventory"
                      type="number"
                      min="0"
                      max="999"
                      value={formData.oneOnOneInventory}
                      onChange={(e) => {
                        const parsed = parseInt(e.target.value);
                        const clamped = isNaN(parsed) ? 0 : Math.max(0, Math.min(999, parsed));
                        setFormData((prev) => ({ ...prev, oneOnOneInventory: clamped }));
                      }}
                    />
                    <p className="text-sm text-muted-foreground mt-1">Available 1-on-1 mentorship slots</p>
                  </div>
                  <div>
                    <Label htmlFor="groupInventory">Group Inventory</Label>
                    <Input
                      id="groupInventory"
                      type="number"
                      min="0"
                      max="999"
                      value={formData.groupInventory}
                      onChange={(e) => {
                        const parsed = parseInt(e.target.value);
                        const clamped = isNaN(parsed) ? 0 : Math.max(0, Math.min(999, parsed));
                        setFormData((prev) => ({ ...prev, groupInventory: clamped }));
                      }}
                    />
                    <p className="text-sm text-muted-foreground mt-1">Available group mentorship slots</p>
                  </div>
                  <div>
                    <Label htmlFor="maxActiveStudents">Max Active Students</Label>
                    <Input
                      id="maxActiveStudents"
                      type="number"
                      min="1"
                      max="100"
                      value={formData.maxActiveStudents}
                      onChange={(e) => {
                        const parsed = parseInt(e.target.value);
                        const clamped = isNaN(parsed) ? 10 : Math.max(1, Math.min(100, parsed));
                        setFormData((prev) => ({ ...prev, maxActiveStudents: clamped }));
                      }}
                    />
                    <p className="text-sm text-muted-foreground mt-1">Maximum concurrent mentees</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">No booking record exists for this instructor.</p>
                  <p className="text-sm text-muted-foreground">To enable bookings, create a booking record via the POST /api/admin/instructors/[id]/create-instructor-booking endpoint or admin inventory page.</p>
                </div>
              )}
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setActiveTab("social")}>Back</Button>
                <Button onClick={() => setActiveTab("testimonials")}>Next</Button>
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

      {/* Product Deactivation Confirmation Dialog */}
      <Dialog open={showProductDeactivationDialog} onOpenChange={setShowProductDeactivationDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deactivate Products</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This instructor has {activeProducts.length} active product(s) on Stripe.
              To deactivate this instructor, we will also deactivate these products on Stripe.
            </p>
            <div className="max-h-40 overflow-y-auto border rounded p-2">
              {activeProducts.map((product) => (
                <div key={product.id} className="text-sm py-1">
                  <span className="font-medium">{product.title}</span>
                  {product.stripeProductId && (
                    <span className="text-muted-foreground ml-2">
                      (ID: {product.stripeProductId})
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-sm text-amber-600">
              Note: Products will be set to inactive on Stripe. You can manually reactivate them later if needed.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProductDeactivationDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleDeactivateWithProducts}
              disabled={updateMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Deactivate Both
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deactivationResults?.stripeFailed && deactivationResults.stripeFailed.length > 0 ? "Partial Success" : "Success"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm">{successMessage}</p>

            {deactivationResults && (
              <div className="space-y-2">
                {deactivationResults.stripeSuccess.length > 0 && (
                  <div className="text-sm text-green-600">
                    <p className="font-medium">Successfully deactivated on Stripe:</p>
                    <ul className="list-disc pl-4 mt-1">
                      {deactivationResults.stripeSuccess.map((id, i) => (
                        <li key={i} className="text-xs">{id}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {deactivationResults.stripeFailed.length > 0 && (
                  <div className="text-sm text-red-600">
                    <p className="font-medium">Failed to deactivate on Stripe:</p>
                    <ul className="list-disc pl-4 mt-1">
                      {deactivationResults.stripeFailed.map((item, i) => (
                        <li key={i} className="text-xs">
                          {item.id}: {item.error}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs">
                      You can try again manually or deactivate these products directly in the Stripe dashboard.
                    </p>
                    <Button
                      variant="link"
                      className="h-auto p-0 text-blue-600"
                      asChild
                    >
                      <a
                        href="https://dashboard.stripe.com/products"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Stripe Dashboard
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowSuccessDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
