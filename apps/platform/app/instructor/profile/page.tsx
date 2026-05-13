import { requireRole } from "@/lib/auth-helpers";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

async function getProfileData() {
  const user = await requireRole("instructor");
  const convex = getConvexClient();

  const instructor = await convex.query(api.instructors.getInstructorByUserId, {
    userId: user.id,
  });

  if (!instructor) {
    return null;
  }

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
    socials: (instructor.socials as { twitter?: string; instagram?: string; youtube?: string; bluesky?: string; website?: string; artstation?: string } | null) ?? null,
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