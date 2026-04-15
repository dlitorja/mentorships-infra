import { requireRole } from "@/lib/auth-helpers";
import { getInstructorByUserId } from "@mentorships/db";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

async function getProfileData() {
  const user = await requireRole("mentor");
  const instructor = await getInstructorByUserId(user.id);

  if (!instructor) {
    return null;
  }

  return {
    id: instructor.id,
    name: instructor.name,
    slug: instructor.slug,
    tagline: instructor.tagline,
    bio: instructor.bio,
    specialties: instructor.specialties,
    background: instructor.background,
    profileImageUrl: instructor.profileImageUrl,
    portfolioImages: instructor.portfolioImages,
    socials: instructor.socials,
    isActive: instructor.isActive,
    updatedAt: instructor.updatedAt.toISOString(),
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
