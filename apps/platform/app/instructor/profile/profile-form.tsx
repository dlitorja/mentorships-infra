"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { Loader2, Save, AlertCircle, CheckCircle2, Plus, Trash2, ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, createTestimonial, deleteTestimonial, createStudentResult, deleteStudentResult, updateInstructorProfile } from "@/lib/queries/api-client";

interface Socials {
  twitter?: string;
  instagram?: string;
  youtube?: string;
  bluesky?: string;
  website?: string;
  artstation?: string;
}

interface ProfileData {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  bio: string | null;
  specialties: string[] | null;
  background: string[] | null;
  profileImageUrl: string | null;
  profileImageUploadPath: string | null;
  portfolioImages: string[] | null;
  socials: Socials | null;
  isActive: boolean;
  updatedAt: string;
}

interface ProfileFormProps {
  initialData: ProfileData;
}

const PROFILE_UPLOAD_ENDPOINT = "/api/instructor/upload-image?type=profile";
const PORTFOLIO_UPLOAD_ENDPOINT = "/api/instructor/upload-image?type=portfolio";
const STUDENT_RESULT_UPLOAD_ENDPOINT = "/api/instructor/student-results/upload";

interface Testimonial {
  id: string;
  name: string;
  text: string;
  createdAt: string;
}

interface StudentResult {
  id: string;
  imageUrl: string | null;
  imageUploadPath: string | null;
  studentName: string | null;
  createdAt: string;
}

/**
 * Fetches the signed-in instructor's testimonials.
 */
async function fetchTestimonials(): Promise<{ items: Testimonial[] }> {
  return apiFetch<{ items: Testimonial[] }>("/api/instructor/testimonials");
}

/**
 * Fetches the signed-in instructor's student results.
 */
async function fetchStudentResults(): Promise<{ items: StudentResult[] }> {
  return apiFetch<{ items: StudentResult[] }>("/api/instructor/student-results");
}



/**
 * Form for instructors to edit their public profile, portfolio, testimonials, and student results.
 */
export function ProfileForm({ initialData }: ProfileFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const baseId = React.useId();

  const [name, setName] = useState(initialData.name);
  const [tagline, setTagline] = useState(initialData.tagline ?? "");
  const [bio, setBio] = useState(initialData.bio ?? "");
  const [specialties, setSpecialties] = useState(initialData.specialties?.join(", ") ?? "");
  const [background, setBackground] = useState(initialData.background?.join(", ") ?? "");
  const [profileImageUrl, setProfileImageUrl] = useState(initialData.profileImageUrl ?? "");
  const [profileImageUploadPath, setProfileImageUploadPath] = useState(initialData.profileImageUploadPath ?? "");
  const [portfolioImages, setPortfolioImages] = useState<string[]>(initialData.portfolioImages ?? []);
  const [socials, setSocials] = useState<Socials>(initialData.socials ?? {});
  const [showTestimonialDialog, setShowTestimonialDialog] = useState(false);
  const [testimonialForm, setTestimonialForm] = useState({ name: "", text: "" });

  const [showStudentResultDialog, setShowStudentResultDialog] = useState(false);

  const [studentResultForm, setStudentResultForm] = useState({ imageUrl: "", imageUploadPath: "", studentName: "" });

  const { data: testimonialsData } = useQuery({
    queryKey: ["testimonials"],
    queryFn: fetchTestimonials,
  });

  const testimonials = testimonialsData?.items || [];

  const { data: studentResultsData, refetch: refetchStudentResults } = useQuery({

    queryKey: ["instructor-student-results"],

    queryFn: fetchStudentResults,
  });

  const addTestimonialMutation = useMutation({
    mutationFn: createTestimonial,
    onSuccess: () => {
      setShowTestimonialDialog(false);
      setTestimonialForm({ name: "", text: "" });
      queryClient.invalidateQueries({ queryKey: ["testimonials"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to add testimonial");
    },
  });

  const deleteTestimonialMutation = useMutation({
    mutationFn: deleteTestimonial,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["testimonials"] }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete testimonial");
    },
  });

  const addStudentResultMutation = useMutation({

    mutationFn: createStudentResult,

    onSuccess: () => {
      setShowStudentResultDialog(false);
      setStudentResultForm({ imageUrl: "", imageUploadPath: "", studentName: "" });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to add result");
    },
  });

  const deleteStudentResultMutation = useMutation({

    mutationFn: deleteStudentResult,

    onSuccess: () => refetchStudentResults(),

  });

  const studentResults = studentResultsData?.items || [];

  const handlePortfolioAdd = (url: string) => {
    if (url && !portfolioImages.includes(url)) {
      setPortfolioImages([...portfolioImages, url]);
    }
  };

  const handlePortfolioRemove = (url: string) => {
    setPortfolioImages(portfolioImages.filter((img) => img !== url));
  };

  const handleSocialChange = (field: keyof Socials, value: string) => {
    setSocials((prev) => ({ ...prev, [field]: value || undefined }));
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];

    if (!name.trim()) {
      errors.push("Name is required");
    }

    if (!profileImageUrl.trim()) {
      errors.push("Profile image is required");
    }

    if (portfolioImages.length < 4) {
      errors.push(`At least 4 portfolio images required (currently ${portfolioImages.length})`);
    }

    return errors;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setError(validationErrors.join(". "));
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        name: name.trim(),
        tagline: tagline.trim() || null,
        bio: bio.trim() || null,
        specialties: specialties
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        background: background
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        profileImageUrl: profileImageUrl.trim() || null,
        profileImageUploadPath: profileImageUploadPath || null,
        portfolioImages,
        socials: Object.keys(socials).length > 0 ? socials : null,
      };

      const result = await updateInstructorProfile({
        ...payload,
        socials: payload.socials as Record<string, string | undefined> | null,
      });

      if (!result.ok) {
        if (result.data.validationErrors) {
          setError(result.data.validationErrors.join(". "));
        } else {
          setError(result.data.error || "Failed to update profile");
        }
        return;
      }

      setSuccess(true);
      router.refresh();

      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {success && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" />
              <p>Profile updated successfully!</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Your public profile details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Profile URL</Label>
            <Input id="slug" value={`/instructors/${initialData.slug}`} disabled />
            <p className="text-xs text-muted-foreground">Contact admin to change your profile URL</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tagline">Tagline</Label>
            <Input
              id="tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="A short tagline (e.g., 'Digital Artist & Instructor')"
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell potential students about yourself..."
              rows={5}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile Image *</CardTitle>
          <CardDescription>This image appears on your public profile</CardDescription>
        </CardHeader>
        <CardContent>
          <ImageUploadField
            label=""
            value={profileImageUrl}
            onChange={(url) => {
              setProfileImageUrl(url);
              setProfileImageUploadPath("");
            }}
            onUploadComplete={(_url, path) => setProfileImageUploadPath(path)}
            uploadEndpoint={PROFILE_UPLOAD_ENDPOINT}
            placeholder="https://example.com/profile.jpg"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Portfolio Images *</CardTitle>
          <CardDescription>
            Add at least 4 images showcasing your work ({portfolioImages.length}/4 minimum)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ImageUploadField
            label="Add Portfolio Image"
            value=""
            onChange={handlePortfolioAdd}
            onCommit={handlePortfolioAdd}
            uploadEndpoint={PORTFOLIO_UPLOAD_ENDPOINT}
            placeholder="https://example.com/portfolio.jpg"
          />

          {portfolioImages.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {portfolioImages.map((url, index) => (
                <div key={index} className="relative group h-32">
                  <Image
                    src={url}
                    alt={`Portfolio ${index + 1}`}
                    fill
                    unoptimized
                    className="object-cover rounded-lg border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-7 w-7 rounded-full opacity-100 md:opacity-0 group-hover:md:opacity-100 focus-visible:md:opacity-100 transition-opacity"
                    onClick={() => handlePortfolioRemove(url)}
                    aria-label={`Remove portfolio image ${index + 1}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {portfolioImages.length < 4 && (
            <p className="text-sm text-amber-600">
              You need {4 - portfolioImages.length} more image(s) to meet the minimum requirement
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Specialties & Background</CardTitle>
          <CardDescription>Comma-separated lists of your expertise areas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="specialties">Specialties</Label>
            <Input
              id="specialties"
              value={specialties}
              onChange={(e) => setSpecialties(e.target.value)}
              placeholder="e.g., Character Design, Digital Painting, Concept Art"
            />
            <p className="text-xs text-muted-foreground">Separate with commas</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="background">Background</Label>
            <Input
              id="background"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              placeholder="e.g., 10+ Years Experience, Art Institute Graduate"
            />
            <p className="text-xs text-muted-foreground">Separate with commas</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Social Links</CardTitle>
          <CardDescription>Your presence on other platforms</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="twitter">Twitter / X</Label>
              <Input
                id="twitter"
                value={socials.twitter ?? ""}
                onChange={(e) => handleSocialChange("twitter", e.target.value)}
                placeholder="@username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="instagram">Instagram</Label>
              <Input
                id="instagram"
                value={socials.instagram ?? ""}
                onChange={(e) => handleSocialChange("instagram", e.target.value)}
                placeholder="@username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="youtube">YouTube</Label>
              <Input
                id="youtube"
                value={socials.youtube ?? ""}
                onChange={(e) => handleSocialChange("youtube", e.target.value)}
                placeholder="Channel URL"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bluesky">Bluesky</Label>
              <Input
                id="bluesky"
                value={socials.bluesky ?? ""}
                onChange={(e) => handleSocialChange("bluesky", e.target.value)}
                placeholder="@username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={socials.website ?? ""}
                onChange={(e) => handleSocialChange("website", e.target.value)}
                placeholder="https://yoursite.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="artstation">ArtStation</Label>
              <Input
                id="artstation"
                value={socials.artstation ?? ""}
                onChange={(e) => handleSocialChange("artstation", e.target.value)}
                placeholder="Profile URL"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Testimonials</CardTitle>
                <CardDescription>Showcase student feedback</CardDescription>
              </div>
              <Button size="sm" type="button" onClick={() => setShowTestimonialDialog(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {testimonials.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 text-sm">No testimonials yet</p>
            ) : (
              <div className="space-y-3">
                {testimonials.map((t) => (
                  <div key={t.id} className="border rounded-lg p-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{t.name}</p>
                        <p className="text-sm text-muted-foreground line-clamp-2">{t.text}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        onClick={() => deleteTestimonialMutation.mutate(t.id)}
                        disabled={deleteTestimonialMutation.isPending}
                        aria-label={`Delete testimonial from ${t.name}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Student Results</CardTitle>
                <CardDescription>Before/after images from students</CardDescription>
              </div>
              <Button size="sm" type="button" onClick={() => setShowStudentResultDialog(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {studentResults.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 text-sm">No results yet</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {studentResults.map((r) => (
                  <div key={r.id} className="relative group h-20">
                    {r.imageUrl ? (
                      <Image src={r.imageUrl} alt={r.studentName ? `Result from ${r.studentName}` : "Student result"} fill unoptimized className="object-cover rounded" />
                    ) : (
                      <div className="w-full h-20 bg-muted rounded flex items-center justify-center">
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        variant="destructive"
                        size="icon"
                        type="button"
                        onClick={() => deleteStudentResultMutation.mutate(r.id)}
                        disabled={deleteStudentResultMutation.isPending}
                        aria-label={`Delete student result${r.studentName ? ` from ${r.studentName}` : ""}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {r.studentName && (
                      <p className="text-xs text-center mt-1 truncate">{r.studentName}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showTestimonialDialog} onOpenChange={setShowTestimonialDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Testimonial</DialogTitle>
            <DialogDescription>
              Add a quote from a student. Both a name and the testimonial text are required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${baseId}-testimonial-name`}>Name</Label>
              <Input
                id={`${baseId}-testimonial-name`}
                value={testimonialForm.name}
                onChange={(e) => setTestimonialForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Student name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${baseId}-testimonial-text`}>Testimonial</Label>
              <Textarea
                id={`${baseId}-testimonial-text`}
                value={testimonialForm.text}
                onChange={(e) => setTestimonialForm((prev) => ({ ...prev, text: e.target.value }))}
                placeholder="What they said..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setShowTestimonialDialog(false)}>Cancel</Button>
            <Button
              type="button"
              onClick={() => addTestimonialMutation.mutate(testimonialForm)}
              disabled={!testimonialForm.name || !testimonialForm.text || addTestimonialMutation.isPending}
            >
              {addTestimonialMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showStudentResultDialog} onOpenChange={setShowStudentResultDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Student Result</DialogTitle>
            <DialogDescription>
              Upload a before/after image from a student. The image is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ImageUploadField
              label="Result Image"
              value={studentResultForm.imageUrl}
              onChange={(url) => setStudentResultForm((prev) => ({ ...prev, imageUrl: url, imageUploadPath: "" }))}
              onUploadComplete={(_url, path) => setStudentResultForm((prev) => ({ ...prev, imageUploadPath: path }))}
              uploadEndpoint={STUDENT_RESULT_UPLOAD_ENDPOINT}
            />
            <div className="space-y-2">
              <Label htmlFor={`${baseId}-student-name`}>Student Name (optional)</Label>
              <Input
                id={`${baseId}-student-name`}
                value={studentResultForm.studentName}
                onChange={(e) => setStudentResultForm((prev) => ({ ...prev, studentName: e.target.value }))}
                placeholder="Student name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setShowStudentResultDialog(false)}>Cancel</Button>
            <Button
              type="button"
              onClick={() => addStudentResultMutation.mutate(studentResultForm)}
              disabled={!studentResultForm.imageUrl || addStudentResultMutation.isPending}
            >
              {addStudentResultMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting} size="lg">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Profile
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
