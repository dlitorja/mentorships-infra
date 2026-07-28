import { z } from "zod";

export { freeMentorshipFormSchema } from "@mentorships/schemas";

/**
 * Email validation schema
 */
export const emailSchema = z
  .string()
  .email("Please enter a valid email address")
  .transform((email) => email.trim().toLowerCase());

/**
 * Waitlist form schema
 */
export const waitlistFormSchema = z.object({
  email: emailSchema,
});

export type WaitlistFormData = z.infer<typeof waitlistFormSchema>;

/**
 * Product creation form schema
 * At least one of stripeProductId or stripePriceId must be provided (non-empty)
 */
export const productFormSchema = z
  .object({
    stripeProductId: z.string(),
    stripePriceId: z.string(),
  })
  .refine(
    (data) => data.stripeProductId.trim() || data.stripePriceId.trim(),
    {
      message: "Either Stripe Product ID or Price ID is required",
      path: ["stripePriceId"], // Show error on priceId field
    }
  );

export type ProductFormData = z.infer<typeof productFormSchema>;
