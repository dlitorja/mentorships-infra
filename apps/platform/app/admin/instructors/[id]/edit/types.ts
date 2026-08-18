'use client';

import { z } from "zod";

export const NONE_SENTINEL = "__none__";

export class ApiError extends Error {
  response?: Record<string, unknown>;
  status?: number;
  
  constructor(message: string, response?: Record<string, unknown>, status?: number) {
    super(message);
    this.name = "ApiError";
    this.response = response;
    this.status = status;
  }
}

export type Socials = {
  twitter?: string;
  instagram?: string;
  youtube?: string;
  bluesky?: string;
  website?: string;
  artstation?: string;
};

export type Testimonial = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
};

export type StudentResult = {
  id: string;
  imageUrl: string | null;
  imageUploadPath: string | null;
  studentName: string | null;
  createdAt: string;
};

export type InstructorFormData = {
  name: string;
  slug: string;
  email: string;
  discordVoiceChannelUrl?: string;
  tagline: string;
  bio: string;
  specialties: string[];
  background: string[];
  profileImageUrl: string;
  profileImageUploadPath: string;
  portfolioImages: string[];
  socials: Socials;
  isActive: boolean;
  isListed: boolean;
  userId: string | null;
  instructorId: string | null;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
};

export type ActiveProduct = {
  id: string;
  title: string;
  stripeProductId: string | null;
  stripePriceId: string | null;
};

export type InstructorDetail = InstructorFormData & {
  testimonials: Testimonial[];
  studentResults: StudentResult[];
};

export type UpdateInstructorResponse = {
  success: boolean;
  message: string;
  productsDeactivated?: {
    stripeSuccess: string[];
    stripeFailed: { id: string; error: string }[];
  };
  instructor?: {
    id: string;
    name: string;
    slug: string;
    tagline: string | null;
    bio: string | null;
    specialties: string[];
    background: string[];
    profileImageUrl: string | null;
    portfolioImages: string[];
    socials: Socials | null;
    isActive: boolean;
    userId: string | null;
    instructorId: string | null;
    updatedAt: string;
  };
};

export const updateInstructorResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  productsDeactivated: z.object({
    stripeSuccess: z.array(z.string()),
    stripeFailed: z.array(z.object({ id: z.string(), error: z.string() })),
  }).optional(),
  instructor: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    tagline: z.string().nullable(),
    bio: z.string().nullable(),
    specialties: z.array(z.string()),
    background: z.array(z.string()),
    profileImageUrl: z.string().nullable(),
    profileImageUploadPath: z.string().nullable(),
    portfolioImages: z.array(z.string()),
    socials: z.record(z.string(), z.string().optional()).nullable(),
    isActive: z.boolean(),
    userId: z.string().nullable(),
    instructorId: z.string().nullable(),
    updatedAt: z.string(),
  }).optional(),
});

export const instructorsResponseSchema = z.object({
  instructors: z.array(z.object({
    instructorId: z.string(),
    userId: z.string(),
    email: z.string(),
    displayName: z.string(),
    oneOnOneInventory: z.number(),
    groupInventory: z.number(),
    maxActiveStudents: z.number(),
    activeStudentCount: z.number(),
    createdAt: z.string(),
  })),
});

export type InstructorsResponse = z.infer<typeof instructorsResponseSchema>;
