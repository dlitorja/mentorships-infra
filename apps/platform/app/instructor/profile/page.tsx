import { requireRole } from "@/lib/auth-helpers";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { ProfileForm } from "./profile-form";
import { z } from "zod";

export const dynamic = "force-dynamic";

const socialsSchema = z.object({
  twitter: z.string().optional(),
  instagram: z.string().optional(),
  youtube: z.string().optional(),
  bluesky: z.string().optional(),
  website: z.string().optional(),
  artstation: z.string().optional(),
});

type InstructorProfileData = {
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
  socials: z.infer<typeof socialsSchema> | null;
  isActive: boolean;
  updatedAt: string;
};

async function getProfileData(): Promise<InstructorProfileData | null> {
  const user = await requireRole("instructor");
  const convex = getConvexClient();

  const instructor = await convex.query(api.instructors.getInstructorByUserId, {
    userId: user.id,
  });

  if (!instructor) {
    return null;
  }

  const parsedSocials = socialsSchema.nullable().safeParse(instructor.socials ?? null);

  return {
    id: instructor._id,
    name: instructor.name ?? "",
    slug: instructor.slug ?? "",
    tagline: instructor.tagline ?? null,
    bio: instructor.bio ?? null,
    specialties: instructor.specialties ?? null,
    background: instructor.background ?? null,
    profileImageUrl: instructor.profileImageUrl ?? null,
    profileImageUploadPath: instructor.profileImageUploadPath ?? null,
    portfolioImages: instructor.portfolioImages ?? null,
    socials: parsedSocials.success ? parsedSocials.data : null,
    isActive: instructor.isActive ?? false,
    updatedAt: instructor.updatedAt ? new Date(instructor.updatedAt).toISOString() : new Date(instructor._creationTime).toISOString(),
  };
}

export default async function InstructorProfilePage() {
  const profileData = await getProfileData();

  if (!profileData) {
    return (
      <ProtectedLayout currentPath="/instructor/profile">
        <div className="container mx-auto p-4 md:p-8">
          <p className="text-muted-foreground">
            Instructor profile not found. Please contact support.
          </p>
        </div>
      </ProtectedLayout>
    );
  }

  return (
    <ProtectedLayout currentPath="/instructor/profile">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit Profile</h1>
          <p className="text-muted-foreground">
            Update your public instructor profile. Fields marked with * are required.
          </p>
        </div>

        <ProfileForm initialData={profileData} />
      </div>
    </ProtectedLayout>
  );
}