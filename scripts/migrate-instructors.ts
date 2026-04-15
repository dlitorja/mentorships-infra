import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing environment variables");
  console.error("NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl ? "✓" : "✗");
  console.error("SUPABASE_SERVICE_ROLE_KEY:", supabaseKey ? "✓" : "✗");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Full correct instructor list from apps/marketing/lib/instructors.ts
const instructorsData = [
  {
    name: "Jordan Jardine",
    slug: "jordan-jardine",
    tagline: "Toronto-based Freelance Artist Specializing in Digital Painting, Illustration and Concept Art",
    bio: "Jordan Jardine is a Toronto-based freelance artist specializing in digital painting, illustration and concept art.",
    specialties: ["Digital Painting", "Illustration", "Concept Art"],
    background: ["Freelance", "Indie"],
    profileImageUrl: "/instructors/jordan-jardine/work-2.jpg",
    portfolioImages: ["/instructors/jordan-jardine/work-1.jpg", "/instructors/jordan-jardine/work-2.jpg", "/instructors/jordan-jardine/work-3.jpg"],
    socials: { website: "https://www.jordanjardine.com" },
    isActive: true,
  },
  {
    name: "Cameron Nissen",
    slug: "cameron-nissen",
    tagline: "Freelance Illustrator and Concept Artist",
    bio: "Cameron Nissen is a seasoned freelance illustrator and concept artist.",
    specialties: ["Illustration", "Concept Art", "Painterly Style"],
    background: ["Gaming", "Indie"],
    profileImageUrl: "/instructors/cameron-nissen/work-6.jpg",
    portfolioImages: ["/instructors/cameron-nissen/work-1.jpg", "/instructors/cameron-nissen/work-2.jpg", "/instructors/cameron-nissen/work-3.jpg", "/instructors/cameron-nissen/work-4.jpg", "/instructors/cameron-nissen/work-5.jpg", "/instructors/cameron-nissen/work-6.jpg"],
    socials: { instagram: "https://www.instagram.com/crookednosedelf/?hl=en" },
    isActive: true,
  },
  {
    name: "Nino Vecia",
    slug: "nino-vecia",
    tagline: "Freelance Illustrator and Independent Artist",
    bio: "Nino Vecia is a seasoned freelance illustrator and independent artist.",
    specialties: ["Illustration", "Character Design", "Fantasy Art"],
    background: ["Gaming", "Indie"],
    profileImageUrl: "/instructors/nino-vecia/profile.jpg",
    portfolioImages: ["/instructors/nino-vecia/work-1.jpg", "/instructors/nino-vecia/work-2.jpg", "/instructors/nino-vecia/work-3.jpg"],
    socials: { instagram: "https://www.instagram.com/ninovecia/?hl=en" },
    isActive: true,
  },
  {
    name: "Oliver Titley",
    slug: "oliver-titley",
    tagline: "Concept Artist and Illustrator",
    bio: "Oliver Titley is a concept artist and illustrator with experience in the gaming industry.",
    specialties: ["Concept Art", "Illustration", "Character Design"],
    background: ["Gaming"],
    profileImageUrl: "/instructors/oliver-titley/profile.jpg",
    portfolioImages: ["/instructors/oliver-titley/work-1.jpg", "/instructors/oliver-titley/work-2.jpg"],
    socials: {},
    isActive: true,
  },
  {
    name: "Malina Dowling",
    slug: "malina-dowling",
    tagline: "Digital Artist and Instructor",
    bio: "Malina Dowling is a digital artist and instructor specializing in character design and illustration.",
    specialties: ["Illustration", "Character Design", "Digital Painting"],
    background: ["Indie"],
    profileImageUrl: "/instructors/malina-dowling/profile.jpg",
    portfolioImages: ["/instructors/malina-dowling/work-1.jpg", "/instructors/malina-dowling/work-2.jpg"],
    socials: {},
    isActive: true,
  },
  {
    name: "Rakasa",
    slug: "rakasa",
    tagline: "Concept Artist and Illustrator",
    bio: "Rakasa is a concept artist and illustrator with a focus on fantasy and sci-fi art.",
    specialties: ["Concept Art", "Illustration", "Fantasy Art"],
    background: ["Indie", "Gaming"],
    profileImageUrl: "/instructors/rakasa/profile.jpg",
    portfolioImages: ["/instructors/rakasa/work-1.jpg", "/instructors/rakasa/work-2.jpg"],
    socials: {},
    isActive: true,
  },
  {
    name: "Amanda Kiefer",
    slug: "amanda-kiefer",
    tagline: "Concept Artist Specializing in Environment Art",
    bio: "Amanda Kiefer is a concept artist specializing in environment art and visual development.",
    specialties: ["Concept Art", "Environment Art", "Visual Development"],
    background: ["Gaming", "Film"],
    profileImageUrl: "/instructors/amanda-kiefer/profile.jpg",
    portfolioImages: ["/instructors/amanda-kiefer/work-1.jpg", "/instructors/amanda-kiefer/work-2.jpg"],
    socials: {},
    isActive: true,
  },
  {
    name: "Neil Gray",
    slug: "neil-gray",
    tagline: "Professional Concept Artist and Illustrator",
    bio: "Neil Gray is a professional concept artist and illustrator with years of experience in the entertainment industry.",
    specialties: ["Concept Art", "Illustration", "Character Design"],
    background: ["Gaming", "Film"],
    profileImageUrl: "/instructors/neil-gray/profile.jpg",
    portfolioImages: ["/instructors/neil-gray/work-1.jpg", "/instructors/neil-gray/work-2.jpg"],
    socials: {},
    isActive: true,
  },
  {
    name: "Ash Kirk",
    slug: "ash-kirk",
    tagline: "Artist and Instructor Specializing in Character Design",
    bio: "Ash Kirk is an artist and instructor specializing in character design and concept art.",
    specialties: ["Character Design", "Concept Art", "Illustration"],
    background: ["Indie", "Gaming"],
    profileImageUrl: "/instructors/ash-kirk/profile.jpg",
    portfolioImages: ["/instructors/ash-kirk/work-1.jpg", "/instructors/ash-kirk/work-2.jpg"],
    socials: {},
    isActive: true,
  },
  {
    name: "Andrea Sipl",
    slug: "andrea-sipl",
    tagline: "Concept Artist and Illustrator",
    bio: "Andrea Sipl is a concept artist and illustrator with experience in game development.",
    specialties: ["Concept Art", "Illustration", "Character Design"],
    background: ["Gaming"],
    profileImageUrl: "/instructors/andrea-sipl/profile.jpg",
    portfolioImages: ["/instructors/andrea-sipl/work-1.jpg", "/instructors/andrea-sipl/work-2.jpg"],
    socials: {},
    isActive: true,
  },
  {
    name: "Kimea Zizzari",
    slug: "kimea-zizzari",
    tagline: "Professional Multimedia Artist and Tattoo Artist",
    bio: "Kimea Zizzari is a professional multimedia artist and tattoo artist.",
    specialties: ["Multimedia Art", "Tattooing", "Convention Circuit"],
    background: ["Indie"],
    profileImageUrl: "/instructors/kimea-zizzari/profile.jpg",
    portfolioImages: ["/instructors/kimea-zizzari/work-1.jpg", "/instructors/kimea-zizzari/work-2.jpg", "/instructors/kimea-zizzari/work-3.jpg"],
    socials: { instagram: "https://www.instagram.com/kimeazizzari/" },
    isActive: true,
  },
  {
    name: "Keven Mallqui",
    slug: "keven-mallqui",
    tagline: "Digital Artist and Illustrator",
    bio: "Keven Mallqui (aka seekevdraw) is a seasoned artist with experience with major IPs.",
    specialties: ["Digital Illustration", "Character Design", "Visual Art"],
    background: ["Indie"],
    profileImageUrl: "/instructors/keven-mallqui/profile.jpg",
    portfolioImages: ["/instructors/keven-mallqui/work-1.jpg", "/instructors/keven-mallqui/work-2.jpg", "/instructors/keven-mallqui/work-3.jpg"],
    socials: { instagram: "https://www.instagram.com/seekevdraw/?hl=en" },
    isActive: true,
  },
  {
    name: "Jeszika Le Vye",
    slug: "jeszika-le-vye",
    tagline: "Imaginative Realist Painter and Independent Artist",
    bio: "Jeszika Le Vye is an imaginative realist painter, working as a professional independent artist.",
    specialties: ["Digital Painting", "Oil Painting", "Illustration"],
    background: ["Indie"],
    profileImageUrl: "/instructors/jeszika-le-vye/profile.jpg",
    portfolioImages: ["/instructors/jeszika-le-vye/work-1.jpg", "/instructors/jeszika-le-vye/work-2.jpg", "/instructors/jeszika-le-vye/work-3.jpg"],
    socials: {},
    isActive: true,
  },
  {
    name: "Kim Myatt",
    slug: "kim-myatt",
    tagline: "Concept Artist and Visual Development Artist",
    bio: "Kim Myatt is a concept artist and visual development artist with experience in animation and games.",
    specialties: ["Concept Art", "Visual Development", "Illustration"],
    background: ["Gaming", "Animation"],
    profileImageUrl: "/instructors/kim-myatt/profile.jpg",
    portfolioImages: ["/instructors/kim-myatt/work-1.jpg", "/instructors/kim-myatt/work-2.jpg"],
    socials: {},
    isActive: true,
  },
];

async function clearData() {
  console.log("Clearing existing data...");
  await supabase.from("instructor_testimonials").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("mentee_results").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("instructors").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  console.log("Cleared.\n");
}

async function migrate() {
  await clearData();
  
  console.log(`Migrating ${instructorsData.length} instructors...\n`);

  let migrated = 0;
  let failed = 0;

  for (const inst of instructorsData) {
    try {
      const { error } = await supabase
        .from("instructors")
        .insert({
          name: inst.name,
          slug: inst.slug,
          tagline: inst.tagline,
          bio: inst.bio,
          specialties: inst.specialties,
          background: inst.background,
          profile_image_url: inst.profileImageUrl,
          portfolio_images: inst.portfolioImages,
          socials: inst.socials,
          is_active: inst.isActive,
        });

      if (error) throw error;

      console.log(`✓ ${inst.name}`);
      migrated++;
    } catch (err) {
      console.error(`✗ ${inst.name}:`, err);
      failed++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Done: ${migrated} succeeded, ${failed} failed`);
  console.log(`========================================`);
}

migrate().catch(console.error).finally(() => process.exit(0));
