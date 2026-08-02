'use client';

import type { MentorshipType } from '@/lib/queries/api-client';

export type Instructor = {
  id: string;
  email: string | null;
  name: string;
};

export type ProductData = {
  id?: string;
  instructorId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price: string;
  currency?: string;
  sessionsPerPack: number;
  validityDays: number;
  mentorshipType: MentorshipType;
  enableStripe: boolean;
  enablePayPal: boolean;
};

export type ProductFormProps = {
  mode: "create" | "edit";
  initialData?: ProductData;
  productId?: string;
  instructors: Instructor[];
  isLoadingInstructors: boolean;
};

export type ProductUpdateResult = {
  success: boolean;
  message: string;
  product?: {
    id: string;
    title: string;
    price: string;
    currency: string;
    sessionsPerPack: number;
    validityDays: number;
    mentorshipType: string;
    stripe: {
      productId: string;
      productLink: string;
      priceId: string;
      priceLink: string;
    } | null;
    paypal: {
      productId: string;
      productLink: string;
    } | null;
  };
  changes?: {
    priceChanged: boolean;
    newStripePriceId: string | null;
    oldStripePriceId: string | null;
  };
};

export type ProductFieldsFormProps = {
  instructors: Instructor[];
  isLoadingInstructors: boolean;
  isSubmitting: boolean;
  onSubmit: (values: ProductData) => void;
  initialData?: ProductData;
  mode?: "create" | "edit";
};

export type ImportFromStripeFormProps = {
  instructors: Instructor[];
  isLoadingInstructors: boolean;
  isSubmitting: boolean;
  onSubmit: (values: { productId?: string; priceId?: string; instructorId?: string }) => void;
};

export type ProductFormDefaultValues = {
  instructorId: string;
  title: string;
  description: string;
  imageUrl: string;
  price: string;
  currency: string;
  sessionsPerPack: number;
  validityDays: number;
  mentorshipType: MentorshipType;
  enableStripe: boolean;
  enablePayPal: boolean;
};

export type StripeImportFormValues = {
  productId: string;
  priceId: string;
  instructorId: string;
};
