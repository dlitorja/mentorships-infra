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
  socialLinks?: {
    twitter?: string;
    instagram?: string;
    artstation?: string;
    website?: string;
    youtube?: string;
    patreon?: string;
    bluesky?: string;
    facebook?: string;
    behance?: string;
  };
}

// Mock instructor data based on the reference site
export const mockInstructors: Instructor[] = [
  {
    id: "jordan-jardine",
    name: "Jordan Jardine",
    slug: "jordan-jardine",
    tagline: "Toronto-based Freelance Artist Specializing in Digital Painting, Illustration and Concept Art",
    bio: "Jordan Jardine is a Toronto-based freelance artist specializing in digital painting, illustration and concept art. He is currently working on projects focusing on character and environment development as well as 2D asset creation. Having trained traditionally, Jordan has a devout love for the beauty of physical media and seeks to incorporate it into his digital work.",
    specialties: ["Digital Painting", "Illustration", "Concept Art", "Character Development", "Environment Development", "2D Asset Creation"],
    background: ["Freelance", "Indie"],
    profileImage: "/instructors/jordan-jardine/profile.jpg",
    workImages: [
      "/instructors/jordan-jardine/work-1.jpg",
      "/instructors/jordan-jardine/work-2.jpg",
      "/instructors/jordan-jardine/work-3.jpg",
    ],
    pricing: {
      oneOnOne: 400,
    },
    socialLinks: {
      website: "https://www.jordanjardine.com",
      instagram: "https://www.instagram.com/jordanjardine",
      artstation: "https://www.artstation.com/jordanjardine",
      facebook: "https://www.facebook.com/jordanjardine",
      behance: "https://www.behance.net/jordanjardine",
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
      "/instructors/cameron-nissen/work-3.jpg",
      "/instructors/cameron-nissen/work-4.jpg",
      "/instructors/cameron-nissen/work-5.jpg",
    ],
    pricing: {
      oneOnOne: 375,
    },
    socialLinks: {
      artstation: "https://www.artstation.com/cameronnissen",
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
      "/instructors/nino-vecia/work-1.png",
      "/instructors/nino-vecia/work-2.png",
      "/instructors/nino-vecia/work-3.png",
      "/instructors/nino-vecia/work-4.png",
      "/instructors/nino-vecia/work-5.png",
    ],
    pricing: {
      oneOnOne: 475,
    },
    socialLinks: {
      website: "https://ninovecia.com",
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
      "/instructors/oliver-titley/work-1.png",
      "/instructors/oliver-titley/work-2.jpg",
      "/instructors/oliver-titley/work-3.png",
    ],
    pricing: {
      oneOnOne: 400,
    },
    socialLinks: {
      artstation: "https://www.artstation.com/olliejoet",
      patreon: "https://www.patreon.com/KappaTurtleWorld",
      youtube: "https://www.youtube.com/@KappaTurtle",
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
      "/instructors/malina-dowling/work-4.jpg",
      "/instructors/malina-dowling/work-5.jpg",
      "/instructors/malina-dowling/work-6.jpg",
    ],
    pricing: {
      oneOnOne: 375,
    },
    socialLinks: {
      instagram: "https://www.instagram.com/malinadowling",
    },
  },
  {
    id: "rakasa",
    name: "Rakasa",
    slug: "rakasa",
    tagline: "Self-Taught Freelance Illustrator",
    bio: "Rakasa is a self-taught freelance illustrator who decided in 2023 to pursue her passion for art full-time, focusing on creating stunning digital illustrations and character designs. She has worked with top-tier clients including Clip Studio Paint, AFK Journey, and Infinity Nikki, bringing her unique artistic vision to major projects in the gaming and software industries.",
    specialties: ["Digital Illustration", "Character Design", "Self-Taught Journey"],
    background: ["Indie"],
    profileImage: "/instructors/rakasa/profile.jpg",
    workImages: [
      "/instructors/rakasa/work-1.jpg",
      "/instructors/rakasa/work-2.jpg",
      "/instructors/rakasa/work-3.jpg",
      "/instructors/rakasa/work-4.jpg",
    ],
    pricing: {
      oneOnOne: 475,
      group: 250,
    },
    socialLinks: {
      instagram: "https://www.instagram.com/rakasa_art",
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
    ],
    pricing: {
      oneOnOne: 375,
    },
    socialLinks: {
      artstation: "https://www.artstation.com/amandakiefer",
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
      "/instructors/neil-gray/work-3.jpg",
      "/instructors/neil-gray/work-4.jpg",
      "/instructors/neil-gray/work-5.jpg",
      "/instructors/neil-gray/work-6.jpg",
      "/instructors/neil-gray/work-7.jpg",
      "/instructors/neil-gray/work-8.jpg",
      "/instructors/neil-gray/work-9.jpg",
    ],
    pricing: {
      oneOnOne: 460,
    },
    socialLinks: {
      artstation: "https://www.artstation.com/neilgray",
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
      "/instructors/ash-kirk/work-4.jpg",
    ],
    pricing: {
      oneOnOne: 375,
    },
    socialLinks: {
      twitter: "https://twitter.com/anearbycat",
      bluesky: "https://bsky.app/profile/anearbycat.bsky.social",
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
      "/instructors/andrea-sipl/work-1.png",
      "/instructors/andrea-sipl/work-2.jpg",
      "/instructors/andrea-sipl/work-3.png",
      "/instructors/andrea-sipl/work-4.png",
      "/instructors/andrea-sipl/work-5.jpg",
      "/instructors/andrea-sipl/work-6.jpg",
      "/instructors/andrea-sipl/work-7.jpg",
    ],
    pricing: {
      oneOnOne: 300,
    },
    socialLinks: {
      website: "https://www.andreasipl.com",
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

/**
 * Get all available instructors (excluding unavailable ones)
 * Returns instructors in random order, but when live data is available,
 * instructors with more available spots will be prioritized towards the top
 */
export function getAvailableInstructors(): Instructor[] {
  const instructors = [...mockInstructors];
  
  // TODO: When live data is available, fetch available spots for each instructor
  // Then sort by available spots (descending) - instructors with more spots first
  // After sorting, randomize within groups of similar availability (e.g., 5+ spots, 3-4 spots, 1-2 spots)
  // Example implementation:
  // const instructorsWithAvailability = await Promise.all(
  //   instructors.map(async (instructor) => ({
  //     ...instructor,
  //     availableSpots: await getAvailableSpots(instructor.id, 'one-on-one')
  //   }))
  // );
  // instructorsWithAvailability.sort((a, b) => b.availableSpots - a.availableSpots);
  // Then randomize within availability groups
  
  // For now, just randomize the order (Fisher-Yates shuffle)
  for (let i = instructors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [instructors[i], instructors[j]] = [instructors[j], instructors[i]];
  }
  
  return instructors;
}

/**
 * Get all available instructors in alphabetical order by name
 * Used for profile page navigation to ensure consistent ordering
 */
export function getAlphabeticalInstructors(): Instructor[] {
  const instructors = [...mockInstructors];
  return instructors.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get navigation info for an instructor
 * Supports custom order (from session storage) or defaults to alphabetical
 */
export function getInstructorNavigation(
  currentSlug: string,
  customOrder?: string[]
): {
  next: Instructor | undefined;
  previous: Instructor | undefined;
  currentIndex: number;
  totalCount: number;
  order: Instructor[];
  mode: 'custom' | 'alphabetical';
} {
  let order: Instructor[];
  let mode: 'custom' | 'alphabetical';

  if (customOrder && customOrder.length > 0) {
    // Use custom order if provided
    const customInstructors = customOrder
      .map((slug) => mockInstructors.find((inst) => inst.slug === slug))
      .filter((inst): inst is Instructor => inst !== undefined);
    
    if (customInstructors.length > 0) {
      order = customInstructors;
      mode = 'custom';
    } else {
      order = getAlphabeticalInstructors();
      mode = 'alphabetical';
    }
  } else {
    order = getAlphabeticalInstructors();
    mode = 'alphabetical';
  }

  const currentIndex = order.findIndex((inst) => inst.slug === currentSlug);
  
  if (currentIndex === -1) {
    return {
      next: undefined,
      previous: undefined,
      currentIndex: -1,
      totalCount: order.length,
      order,
      mode,
    };
  }

  const nextIndex = (currentIndex + 1) % order.length;
  const prevIndex = currentIndex === 0 ? order.length - 1 : currentIndex - 1;

  return {
    next: order[nextIndex],
    previous: order[prevIndex],
    currentIndex: currentIndex + 1, // 1-indexed for display
    totalCount: order.length,
    order,
    mode,
  };
}

/**
 * Get next instructor in the list (alphabetical order for navigation)
 * @deprecated Use getInstructorNavigation instead for better control
 */
export function getNextInstructor(currentSlug: string): Instructor | undefined {
  return getInstructorNavigation(currentSlug).next;
}

/**
 * Get previous instructor in the list (alphabetical order for navigation)
 * @deprecated Use getInstructorNavigation instead for better control
 */
export function getPreviousInstructor(currentSlug: string): Instructor | undefined {
  return getInstructorNavigation(currentSlug).previous;
}

