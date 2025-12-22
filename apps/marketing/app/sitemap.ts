import type { MetadataRoute } from "next";

import { instructors } from "@/lib/instructors";

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_URL ?? "https://mentorships.huckleberry.art";
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();

  return [
    {
      url: `${baseUrl}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/instructors`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...instructors.map((instructor) => ({
      url: `${baseUrl}/instructors/${instructor.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
