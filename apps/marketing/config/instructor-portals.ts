import { NEIL_GRAY_OFFERS, type SalePricing } from "./holiday-sale";

export interface Course {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  promoText?: string;
  buttonText?: string;
  /** Holiday Season Sale pricing. Only rendered while the sale is active. */
  sale?: SalePricing;
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
        url: NEIL_GRAY_OFFERS.drapery,
        imageUrl: "/instructors/neil-gray/course-2.jpg",
        buttonText: "BUY NOW",
        sale: { salePrice: 85, regularPrice: 175, percentOff: 51 },
      },
      {
        title: "Character Design with Neil Gray",
        description: "Learn the fundamentals of character design from concept to final artwork.",
        url: NEIL_GRAY_OFFERS.characterDesign,
        imageUrl: "/instructors/neil-gray/course-1.jpg",
        buttonText: "BUY NOW",
        sale: { salePrice: 95, regularPrice: 195, percentOff: 51 },
      },
    ],
    bundles: [
      {
        title: "Complete Character Art Bundle",
        description: "Get both courses together and save on your character art education.",
        url: NEIL_GRAY_OFFERS.bundle,
        imageUrl: "/instructors/neil-gray/bundle.jpg",
        buttonText: "Get the Bundle",
        sale: { salePrice: 130, regularPrice: 375, percentOff: 65 },
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
