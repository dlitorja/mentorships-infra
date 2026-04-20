export interface Course {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  promoText?: string;
  buttonText?: string;
}

export type Bundle = Course;

export interface InstructorPortal {
  name: string;
  slug: string;
  domains: string[];
  bio?: string;
  imageUrl?: string;
  courses: Course[];
  bundles: Bundle[];
}

export const instructorPortals: InstructorPortal[] = [
  {
    name: "Neil Gray",
    slug: "neil-gray",
    domains: ["artwithneil.com"],
    bio: "Professional character artist with years of experience in the entertainment industry.",
    imageUrl: "/images/instructors/neil-gray.jpg",
    courses: [
      {
title: "Drawing Drapery and Clothing with Neil Gray",
        description: "Master the art of drawing fabric, folds, and clothing on figures.",
        url: "https://home.huckleberry.art/drawing-drapery-and-clothing-with-neil-gray",
        imageUrl: "/instructors/neil-gray/course-2.jpg",
        promoText: "Over 54% off regular price",
        buttonText: "BUY NOW AND SAVE 54%",
      },
      {
title: "Character Design with Neil Gray",
        description: "Learn the fundamentals of character design from concept to final artwork.",
        url: "https://home.huckleberry.art/character-design-with-neil-gray",
        imageUrl: "/instructors/neil-gray/course-1.jpg",
        promoText: "Over 58% off regular price",
        buttonText: "BUY NOW AND SAVE 58%",
      },
    ],
    bundles: [
      {
        title: "Complete Character Art Bundle",
        description: "Get both courses together and save on your character art education.",
        url: "https://home.huckleberry.art/offers/gkAXKN2g/checkout",
        imageUrl: "/instructors/neil-gray/bundle.jpg",
        promoText: "Save over 67% on both courses combined!",
      },
    ],
  },
];

export function getPortalBySlug(slug: string): InstructorPortal | undefined {
  return instructorPortals.find((portal) => portal.slug === slug);
}

export function getPortalByDomain(domain: string): InstructorPortal | undefined {
  const normalizedDomain = domain.split(":")[0].toLowerCase();
  return instructorPortals.find((portal) =>
    portal.domains.some((d) => d.toLowerCase() === normalizedDomain)
  );
}

export function getAllPortals(): InstructorPortal[] {
  return instructorPortals;
}