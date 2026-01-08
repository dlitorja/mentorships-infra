import { z } from "zod";

export const VALID_INSTRUCTOR_SLUGS = [
  "jordan-jardine",
  "cameron-nissen",
  "nino-vecia",
  "oliver-titley",
  "malina-dowling",
  "rakasa",
  "amanda-kiefer",
  "neil-gray",
  "ash-kirk",
  "andrea-sipl",
  "kimea-zizzari",
  "keven-mallqui",
] as const;

export type ValidInstructorSlug = (typeof VALID_INSTRUCTOR_SLUGS)[number];

export function isValidInstructorSlug(slug: string): slug is ValidInstructorSlug {
  return (VALID_INSTRUCTOR_SLUGS as readonly string[]).includes(slug);
}

export const VALID_GROUP_MENTORSHIP_SLUGS: readonly string[] = ["rakasa"];

export function isValidGroupMentorshipSlug(slug: string): boolean {
  return VALID_GROUP_MENTORSHIP_SLUGS.includes(slug);
}

export const waitlistPostSchema = z.object({
  instructorSlug: z
    .string()
    .min(1, { message: "Instructor slug is required" })
    .refine(isValidInstructorSlug, {
      message: "Invalid instructor slug",
    }),
  type: z.enum(["one-on-one", "group"], {
    message: "Type must be 'one-on-one' or 'group'",
  }),
  email: z.string().email().optional(),
});

export type WaitlistPostInput = z.infer<typeof waitlistPostSchema>;

export const waitlistGetSchema = z.object({
  instructorSlug: z
    .string()
    .optional()
    .refine(
      (val) => !val || isValidInstructorSlug(val),
      { message: "Invalid instructor slug" }
    ),
});

export type WaitlistGetInput = z.infer<typeof waitlistGetSchema>;

export const waitlistFormSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address" }),
});

export type WaitlistFormInput = z.infer<typeof waitlistFormSchema>;

export const inventoryResponseSchema = z.object({
  oneOnOneInventory: z.number().min(0),
  groupInventory: z.number().min(0),
});

export type InventoryResponse = z.infer<typeof inventoryResponseSchema>;

export const menteeOnboardingFormSchema = z.object({
  sessionPackId: z.string().min(1, { message: "Please select a mentorship pack" }),
  goals: z.string().min(10, { message: "Please describe your goals (at least 10 characters)" }),
});

export type MenteeOnboardingInput = z.infer<typeof menteeOnboardingFormSchema>;

export const bookSessionFormSchema = z.object({
  scheduledAt: z.string().min(1, { message: "Please select a time slot" }),
});

export type BookSessionInput = z.infer<typeof bookSessionFormSchema>;
