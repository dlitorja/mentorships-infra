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

export type ValidInstructorSlug = typeof VALID_INSTRUCTOR_SLUGS[number];

export function isValidInstructorSlug(slug: string): slug is ValidInstructorSlug {
  return (VALID_INSTRUCTOR_SLUGS as readonly string[]).includes(slug);
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const INSTRUCTOR_SLUG_REGEX = new RegExp(
  `^(?:${VALID_INSTRUCTOR_SLUGS.map(escapeRegExp).join("|")})$`
);

// Instructors who offer group mentorship - sync with instructor configuration
export const VALID_GROUP_MENTORSHIP_SLUGS: readonly string[] = ["rakasa"];

export const waitlistPostSchema = z.object({
  instructorSlug: z
    .string()
    .min(1, "Instructor slug is required")
    .refine(isValidInstructorSlug, {
      message: "Invalid instructor slug",
    }),
  type: z.enum(["one-on-one", "group"], {
    message: "Type must be 'one-on-one' or 'group'",
  }),
  email: z.string().email().optional(),
});

export const waitlistGetSchema = z.object({
  instructorSlug: z
    .string()
    .optional()
    .refine(
      (val) => !val || isValidInstructorSlug(val),
      { message: "Invalid instructor slug" }
    ),
});
