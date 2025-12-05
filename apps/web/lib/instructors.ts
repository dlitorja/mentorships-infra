/**
 * Mock instructor data structure
 * This will be replaced with database queries later
 */

export interface Instructor {
  id: string;
  name: string;
  slug: string; // URL-friendly identifier
  tagline: string; // Short professional tagline
  bio: string; // Full bio description
  specialties: string[]; // e.g., ["Character Design", "Environment Art", "Concept Art"]
  background: string[]; // e.g., ["Gaming", "TV", "Film", "Indie"]
  profileImage: string; // Path to profile image
  workImages: string[]; // Paths to portfolio/work images
  pricing: {
    oneOnOne: number; // Price for 1-on-1 mentorship pack
    group?: number; // Optional group pricing
  };
}

// Mock instructor data based on the reference site
export const mockInstructors: Instructor[] = [
  {
    id: "jordan-jardine",
    name: "Jordan Jardine",
    slug: "jordan-jardine",
    tagline: "Lead Background Artist at Powerhouse Animation",
    bio: "Jordan Jardine is a professional artist with diverse experience in Illustration and Animation Visual Development. Previously the Lead Background Artist at Powerhouse Animation for Tomb Raider: The Legend of Lara Croft.",
    specialties: ["Background Art", "Visual Development", "Animation"],
    background: ["TV", "Animation"],
    profileImage: "/instructors/jordan-jardine/profile.jpg",
    workImages: [
      "/instructors/jordan-jardine/work-1.jpg",
      "/instructors/jordan-jardine/work-2.jpg",
      "/instructors/jordan-jardine/work-3.jpg",
    ],
    pricing: {
      oneOnOne: 400,
    },
  },
  {
    id: "cameron-nissen",
    name: "Cameron Nissen",
    slug: "cameron-nissen",
    tagline: "Freelance Illustrator and Concept Artist",
    bio: "Cameron Nissen is a seasoned freelance illustrator and concept artist. Cameron is known for his fast and expressive painterly style and creating both original work and art inspired by popular IPs like Game of Thrones.",
    specialties: ["Illustration", "Concept Art", "Painterly Style"],
    background: ["Gaming", "Indie"],
    profileImage: "/instructors/cameron-nissen/profile.jpg",
    workImages: [
      "/instructors/cameron-nissen/work-1.jpg",
      "/instructors/cameron-nissen/work-2.jpg",
    ],
    pricing: {
      oneOnOne: 375,
    },
  },
  {
    id: "nino-vecia",
    name: "Nino Vecia",
    slug: "nino-vecia",
    tagline: "Freelance Illustrator and Independent Artist",
    bio: "Nino Vecia is a seasoned freelance illustrator and independent artist who has worked with high-profile clients, including Wizards of the Coast (Magic: The Gathering, Dungeons and Dragons), Blizzard Entertainment, and more.",
    specialties: ["Illustration", "Character Design", "Fantasy Art"],
    background: ["Gaming", "Indie"],
    profileImage: "/instructors/nino-vecia/profile.jpg",
    workImages: [
      "/instructors/nino-vecia/work-1.jpg",
      "/instructors/nino-vecia/work-2.jpg",
      "/instructors/nino-vecia/work-3.jpg",
    ],
    pricing: {
      oneOnOne: 475,
    },
  },
  {
    id: "oliver-titley",
    name: "Oliver Titley",
    slug: "oliver-titley",
    tagline: "Concept Artist, Filmmaker, and YouTuber",
    bio: "Ollie is a concept artist, filmmaker, and YouTuber, with over 6 years of games industry experience working at Paradox Interactive on the Age of Wonders series, and with a successful and rapidly growing YouTube channel.",
    specialties: ["Concept Art", "Game Development", "Content Creation"],
    background: ["Gaming", "Indie"],
    profileImage: "/instructors/oliver-titley/profile.png",
    workImages: [
      "/instructors/oliver-titley/work-1.jpg",
      "/instructors/oliver-titley/work-2.jpg",
    ],
    pricing: {
      oneOnOne: 400,
    },
  },
  {
    id: "malina-dowling",
    name: "Malina Dowling",
    slug: "malina-dowling",
    tagline: "Midwest-based Independent Watercolor Artist",
    bio: "Malina Dowling is a Midwest-based independent artist that works primarily in watercolors. She has traveled the country working and learning the ins and outs of the convention circuit for the better part of a decade.",
    specialties: ["Watercolor", "Traditional Art", "Convention Art"],
    background: ["Indie"],
    profileImage: "/instructors/malina-dowling/profile.jpg",
    workImages: [
      "/instructors/malina-dowling/work-1.jpg",
      "/instructors/malina-dowling/work-2.jpg",
      "/instructors/malina-dowling/work-3.jpg",
    ],
    pricing: {
      oneOnOne: 375,
    },
  },
  {
    id: "rakasa",
    name: "Rakasa",
    slug: "rakasa",
    tagline: "Self-Taught Freelance Illustrator",
    bio: "Rakasa is a self-taught freelance illustrator, and after exploring various fields, she decided in 2023 to pursue her passion for art full-time, focusing on creating stunning digital illustrations and character designs.",
    specialties: ["Digital Illustration", "Character Design", "Self-Taught Journey"],
    background: ["Indie"],
    profileImage: "/instructors/rakasa/profile.jpg",
    workImages: [
      "/instructors/rakasa/work-1.jpg",
      "/instructors/rakasa/work-2.jpg",
    ],
    pricing: {
      oneOnOne: 475,
    },
  },
  {
    id: "amanda-kiefer",
    name: "Amanda Kiefer",
    slug: "amanda-kiefer",
    tagline: "Senior-Level Concept Artist",
    bio: "Amanda Kiefer is a senior-level concept artist with 7+ years of games industry experience creating original characters, environments, weapons and prop concept art for various projects and problem-solving design challenges.",
    specialties: ["Concept Art", "Character Design", "Environment Art", "Prop Design"],
    background: ["Gaming"],
    profileImage: "/instructors/amanda-kiefer/profile.jpg",
    workImages: [
      "/instructors/amanda-kiefer/work-1.jpg",
      "/instructors/amanda-kiefer/work-2.jpg",
      "/instructors/amanda-kiefer/work-3.jpg",
    ],
    pricing: {
      oneOnOne: 375,
    },
  },
  {
    id: "neil-gray",
    name: "Neil Gray",
    slug: "neil-gray",
    tagline: "Concept Artist Specializing in Character, Armor, and Weaponry",
    bio: "Neil Gray is a concept artist who has worked in the gaming industry and has been rapidly growing on social media for intricate and creative character, armor, and weaponry designs.",
    specialties: ["Concept Art", "Character Design", "Armor Design", "Weaponry"],
    background: ["Gaming", "Indie"],
    profileImage: "/instructors/neil-gray/profile.jpg",
    workImages: [
      "/instructors/neil-gray/work-1.jpg",
      "/instructors/neil-gray/work-2.jpg",
    ],
    pricing: {
      oneOnOne: 460,
    },
  },
  {
    id: "ash-kirk",
    name: "Ash Kirk",
    slug: "ash-kirk",
    tagline: "Illustrator, Concept Artist, UI Artist, and Graphic Designer",
    bio: "Ash Kirk is an illustrator, concept artist, UI artist, and graphic designer with over a decade of experience as a professional artist with experience with licenses such as Guild Wars 2, Star Wars, HBO, and more.",
    specialties: ["Illustration", "Concept Art", "UI Art", "Graphic Design"],
    background: ["Gaming", "TV", "Film"],
    profileImage: "/instructors/ash-kirk/profile.jpg",
    workImages: [
      "/instructors/ash-kirk/work-1.jpg",
      "/instructors/ash-kirk/work-2.jpg",
      "/instructors/ash-kirk/work-3.jpg",
    ],
    pricing: {
      oneOnOne: 375,
    },
  },
  {
    id: "andrea-sipl",
    name: "Andrea Sipl",
    slug: "andrea-sipl",
    tagline: "Illustrator, Oil Painter, UI Artist, and Gaming Art Designer",
    bio: "Andrea is an illustrator, oil painter, UI artist, and gaming art designer, who leverages over 16 years of professional experience. She's collaborated with licenses such as ARCHER, Coca-Cola, and FX Networks.",
    specialties: ["Illustration", "Oil Painting", "UI Art", "Game Design"],
    background: ["Gaming", "TV", "Indie"],
    profileImage: "/instructors/andrea-sipl/profile.png",
    workImages: [
      "/instructors/andrea-sipl/work-1.jpg",
      "/instructors/andrea-sipl/work-2.jpg",
    ],
    pricing: {
      oneOnOne: 300,
    },
  },
];

/**
 * Get a randomized array of instructors
 * This ensures equal exposure on the landing page
 */
export function getRandomizedInstructors(): Instructor[] {
  const shuffled = [...mockInstructors];
  // Fisher-Yates shuffle algorithm
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get instructor by slug
 */
export function getInstructorBySlug(slug: string): Instructor | undefined {
  return mockInstructors.find((instructor) => instructor.slug === slug);
}

