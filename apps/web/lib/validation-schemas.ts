import { z } from "zod";

/**
 * Email validation schema
 */
export const emailSchema = z
  .string()
  .email("Please enter a valid email address")
  .transform((email) => email.trim().toLowerCase());

/**
 * Optional email validation schema
 */
export const optionalEmailSchema = z
  .string()
  .optional()
  .refine(
    (email) => !email || email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    {
      message: "Please enter a valid email address",
    }
  )
  .transform((email) => (email?.trim() ? email.trim().toLowerCase() : undefined));

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

/**
 * Matching form schema
 * artGoals is required, email is optional
 */
export const matchingFormSchema = z.object({
  artGoals: z
    .string()
    .min(1, "Please describe your art goals")
    .trim(),
  email: optionalEmailSchema,
});

export type MatchingFormData = z.infer<typeof matchingFormSchema>;

/**
 * Simple matching form schema (AI matching section)
 * Only artGoals required
 */
export const simpleMatchingFormSchema = z.object({
  artGoals: z
    .string()
    .min(1, "Please describe your art goals")
    .trim(),
});

export type SimpleMatchingFormData = z.infer<typeof simpleMatchingFormSchema>;
