"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InstructorImageUpload } from "@/components/admin/instructor-image-upload";
import { Loader2, Save, AlertCircle, CheckCircle2 } from "lucide-react";

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
  portfolioImages: string[] | null;
  socials: Socials | null;
  isActive: boolean;
  updatedAt: string;
}

interface ProfileFormProps {
  initialData: ProfileData;
}

const UPLOAD_ENDPOINT = "/api/instructor/mentees-results/upload";

export function ProfileForm({ initialData }: ProfileFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [name, setName] = useState(initialData.name);
  const [tagline, setTagline] = useState(initialData.tagline ?? "");
  const [bio, setBio] = useState(initialData.bio ?? "");
  const [specialties, setSpecialties] = useState(initialData.specialties?.join(", ") ?? "");
  const [background, setBackground] = useState(initialData.background?.join(", ") ?? "");
  const [profileImageUrl, setProfileImageUrl] = useState(initialData.profileImageUrl ?? "");
  const [portfolioImages, setPortfolioImages] = useState<string[]>(initialData.portfolioImages ?? []);
  const [socials, setSocials] = useState<Socials>(initialData.socials ?? {});

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
        portfolioImages,
        socials: Object.keys(socials).length > 0 ? socials : null,
      };

      const response = await fetch("/api/instructor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.validationErrors) {
          setError(data.validationErrors.join(". "));
        } else {
          setError(data.error || "Failed to update profile");
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
          <InstructorImageUpload
            label=""
            value={profileImageUrl}
            onChange={setProfileImageUrl}
            uploadEndpoint={UPLOAD_ENDPOINT}
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
          <InstructorImageUpload
            label="Add Portfolio Image"
            value=""
            onChange={handlePortfolioAdd}
            uploadEndpoint={UPLOAD_ENDPOINT}
            placeholder="https://example.com/portfolio.jpg"
          />

          {portfolioImages.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {portfolioImages.map((url, index) => (
                <div key={index} className="relative group">
                  <img
                    src={url}
                    alt={`Portfolio ${index + 1}`}
                    className="w-full h-32 object-cover rounded-lg border"
                  />
                  <button
                    type="button"
                    onClick={() => handlePortfolioRemove(url)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
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
