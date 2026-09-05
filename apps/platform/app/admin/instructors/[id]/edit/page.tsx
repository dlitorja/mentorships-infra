'use client';

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft } from "lucide-react";
import { apiFetch, getAdminInstructors } from "@/lib/queries/api-client";
import { ApiRoutes } from "@/lib/routes";
import { isValidDiscordUrl } from "@/lib/validation/discord";
import { useUpdateInstructor } from "./hooks/use-update-instructor";
import { useInstructorForm } from "./hooks/use-instructor-form";
import { useTestimonialsAndResults } from "./hooks/use-testimonials-and-results";
import { useSendInstructorInvitation } from "./hooks/use-send-instructor-invitation";
import { BasicInfoSection } from "./sections/BasicInfoSection";
import { ImagesSection } from "./sections/ImagesSection";
import { TagsSection } from "./sections/TagsSection";
import { SocialLinksSection } from "./sections/SocialLinksSection";
import { InventorySection } from "./sections/InventorySection";
import { KajabiSection } from "./sections/KajabiSection";
import { TestimonialsSection } from "./sections/TestimonialsSection";
import { StudentResultsSection } from "./sections/StudentResultsSection";
import { TestimonialDialog } from "./dialogs/TestimonialDialog";
import { StudentResultDialog } from "./dialogs/StudentResultDialog";
import { ProductDeactivationDialog } from "./dialogs/ProductDeactivationDialog";
import { SuccessDialog } from "./dialogs/SuccessDialog";
import { instructorsResponseSchema } from "./types";
import type { InstructorDetail } from "./types";

async function fetchInstructor(id: string): Promise<InstructorDetail> {
  return apiFetch<InstructorDetail>(ApiRoutes.adminInstructor(id));
}

export default function EditInstructorPage() {
  const params = useParams();
  const instructorId = params.id as string;

  const [activeTab, setActiveTab] = useState("basic");
  const [showTestimonialDialog, setShowTestimonialDialog] = useState(false);
  const [testimonialForm, setTestimonialForm] = useState({ name: "", text: "" });
  const [showStudentResultDialog, setShowStudentResultDialog] = useState(false);
  const [studentResultForm, setStudentResultForm] = useState({ imageUrl: "", imageUploadPath: "", studentName: "" });
  const [showProductDeactivationDialog, setShowProductDeactivationDialog] = useState(false);
  const [activeProducts, setActiveProducts] = useState<{ id: string; title: string; stripeProductId: string | null; stripePriceId: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
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

  const { data: instructorsData } = useQuery({
    queryKey: ["instructors-for-admin"],
    queryFn: async () => {
      const result = await getAdminInstructors({ pageSize: 100 });
      return instructorsResponseSchema.parse(result);
    },
  });

  const { formData, setFormData, customSpecialty, setCustomSpecialty, customBackground, setCustomBackground, toggleTag, addCustomTag, removePortfolioImage, updateSocial } = useInstructorForm(data);

  const updateMutation = useUpdateInstructor({
    instructorId,
    setError,
    setDeactivationResults,
    setSuccessMessage,
    setShowSuccessDialog,
    setActiveProducts,
    setShowProductDeactivationDialog,
    refetch,
  });

  const {
    addTestimonialMutation,
    deleteTestimonialMutation,
    addStudentResultMutation,
    deleteStudentResultMutation,
  } = useTestimonialsAndResults({
    instructorId,
    setError,
    refetch,
    setShowTestimonialDialog,
    setShowStudentResultDialog,
    setTestimonialForm,
    setStudentResultForm,
  });

  const sendInvitationMutation = useSendInstructorInvitation({ instructorId });

  const handleSendInvitation = () => {
    setError(null);
    setSuccessMessage("");
    setShowSuccessDialog(false);
    sendInvitationMutation.mutate(undefined, {
      onSuccess: (result) => {
        setSuccessMessage(result.message || "Invitation sent");
        setShowSuccessDialog(true);
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Failed to send invitation");
      },
    });
  };

  const handleSave = () => {
    setError(null);
    updateMutation.mutate({
      data: formData,
      deactivateProducts: false,
    });
  };

  const handleDeactivateWithProducts = () => {
    setShowProductDeactivationDialog(false);
    updateMutation.mutate({ data: { ...formData, isActive: false }, deactivateProducts: true });
  };

  const discordUrl = (formData.discordVoiceChannelUrl || "").trim();
  const isDiscordUrlInvalid = !isValidDiscordUrl(discordUrl);

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
            onClick={() => {
              if (isDiscordUrlInvalid) return;
              handleSave();
            }}
            disabled={updateMutation.isPending || isDiscordUrlInvalid}
          >
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex w-full overflow-x-auto">
          <TabsTrigger className="whitespace-nowrap" value="basic">Basic Info</TabsTrigger>
          <TabsTrigger className="whitespace-nowrap" value="images">Images</TabsTrigger>
          <TabsTrigger className="whitespace-nowrap" value="tags">Tags</TabsTrigger>
          <TabsTrigger className="whitespace-nowrap" value="social">Social Links</TabsTrigger>
          <TabsTrigger className="whitespace-nowrap" value="inventory">Inventory</TabsTrigger>
          <TabsTrigger className="whitespace-nowrap" value="kajabi">External Checkout</TabsTrigger>
          <TabsTrigger className="whitespace-nowrap" value="testimonials">Testimonials</TabsTrigger>
          <TabsTrigger className="whitespace-nowrap" value="results">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <BasicInfoSection
            formData={formData}
            setFormData={setFormData}
            setActiveTab={setActiveTab}
            instructorsData={instructorsData}
            onSendInvitation={handleSendInvitation}
            isSendingInvitation={sendInvitationMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="images">
          <ImagesSection
            formData={formData}
            setFormData={setFormData}
            removePortfolioImage={removePortfolioImage}
            setActiveTab={setActiveTab}
            instructorId={instructorId}
          />
        </TabsContent>

        <TabsContent value="tags">
          <TagsSection
            formData={formData}
            setFormData={setFormData}
            customSpecialty={customSpecialty}
            setCustomSpecialty={setCustomSpecialty}
            customBackground={customBackground}
            setCustomBackground={setCustomBackground}
            toggleTag={toggleTag}
            addCustomTag={addCustomTag}
            setActiveTab={setActiveTab}
          />
        </TabsContent>

        <TabsContent value="social">
          <SocialLinksSection
            formData={formData}
            updateSocial={updateSocial}
            setActiveTab={setActiveTab}
          />
        </TabsContent>

        <TabsContent value="inventory">
          <InventorySection
            formData={formData}
            setFormData={setFormData}
            setActiveTab={setActiveTab}
          />
        </TabsContent>

        <TabsContent value="kajabi">
          <KajabiSection
            formData={formData}
            setFormData={setFormData}
            setActiveTab={setActiveTab}
          />
        </TabsContent>

        <TabsContent value="testimonials">
          <TestimonialsSection
            testimonials={data.testimonials}
            setActiveTab={setActiveTab}
            onAddClick={() => setShowTestimonialDialog(true)}
            onDelete={(id) => deleteTestimonialMutation.mutate(id)}
            deleteIsPending={deleteTestimonialMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="results">
          <StudentResultsSection
            studentResults={data.studentResults}
            setActiveTab={setActiveTab}
            onAddClick={() => setShowStudentResultDialog(true)}
            onDelete={(id) => deleteStudentResultMutation.mutate(id)}
            deleteIsPending={deleteStudentResultMutation.isPending}
          />
        </TabsContent>
      </Tabs>

      <TestimonialDialog
        open={showTestimonialDialog}
        onOpenChange={setShowTestimonialDialog}
        form={testimonialForm}
        onFormChange={setTestimonialForm}
        onAdd={() => addTestimonialMutation.mutate(testimonialForm)}
        isPending={addTestimonialMutation.isPending}
      />

      <StudentResultDialog
        open={showStudentResultDialog}
        onOpenChange={setShowStudentResultDialog}
        form={studentResultForm}
        onFormChange={setStudentResultForm}
        onAdd={() => addStudentResultMutation.mutate(studentResultForm)}
        isPending={addStudentResultMutation.isPending}
        instructorId={instructorId}
      />

      <ProductDeactivationDialog
        open={showProductDeactivationDialog}
        onOpenChange={setShowProductDeactivationDialog}
        activeProducts={activeProducts}
        onDeactivate={handleDeactivateWithProducts}
        isPending={updateMutation.isPending}
      />

      <SuccessDialog
        open={showSuccessDialog}
        onOpenChange={setShowSuccessDialog}
        successMessage={successMessage}
        deactivationResults={deactivationResults}
      />
    </div>
  );
}
