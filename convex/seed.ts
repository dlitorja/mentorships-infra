import { mutation } from "./_generated/server";
import { v } from "convex/values";

interface TestimonialData {
  name: string;
  text: string;
  role?: string;
}

interface MenteeResultData {
  imageUrl: string;
  studentName?: string;
}

interface PricingData {
  oneOnOne: number;
  group?: number;
}

interface InstructorSeedData {
  name: string;
  slug: string;
  tagline: string;
  bio: string;
  specialties: string[];
  background: string[];
  profileImageUrl: string;
  portfolioImages: string[];
  socials?: Record<string, string>;
  isActive: boolean;
  isNew?: boolean;
  testimonials: TestimonialData[];
  menteeResults: MenteeResultData[];
  pricing: PricingData;
}

const instructorData: InstructorSeedData[] = [
  {
    name: "Jordan Jardine",
    slug: "jordan-jardine",
    tagline: "Toronto-based Freelance Artist Specializing in Digital Painting, Illustration and Concept Art",
    bio: "Jordan Jardine is a Toronto-based freelance artist specializing in digital painting, illustration and concept art. He is currently working on projects focusing on character and environment development as well as 2D asset creation. Having trained traditionally, Jordan has a devout love for the beauty of physical media and seeks to incorporate it into his digital work.",
    specialties: ["Digital Painting", "Illustration", "Concept Art", "Character Development", "Environment Development", "2D Asset Creation"],
    background: ["Freelance", "Indie"],
    profileImageUrl: "/instructors/jordan-jardine/profile.jpg",
    portfolioImages: [
      "/instructors/jordan-jardine/work-1.jpg",
      "/instructors/jordan-jardine/work-2.jpg",
      "/instructors/jordan-jardine/work-3.jpg",
    ],
    socials: {
      website: "https://www.jordanjardine.com",
      instagram: "https://www.instagram.com/jordanjardine",
      artstation: "https://www.artstation.com/jordanjardine",
      facebook: "https://www.facebook.com/jordanjardine",
      behance: "https://www.behance.net/jordanjardine",
    },
    isActive: true,
    isNew: false,
    testimonials: [],
    menteeResults: [],
    pricing: { oneOnOne: 400 },
  },
  {
    name: "Cameron Nissen",
    slug: "cameron-nissen",
    tagline: "Freelance Illustrator and Concept Artist",
    bio: "Cameron Nissen is a seasoned freelance illustrator and concept artist. Cameron is known for his fast and expressive painterly style and creating both original work and art inspired by popular IPs like Game of Thrones.",
    specialties: ["Illustration", "Concept Art", "Painterly Style"],
    background: ["Gaming", "Indie"],
    profileImageUrl: "/instructors/cameron-nissen/profile.jpg",
    portfolioImages: [
      "/instructors/cameron-nissen/work-1.jpg",
      "/instructors/cameron-nissen/work-2.jpg",
      "/instructors/cameron-nissen/work-3.jpg",
      "/instructors/cameron-nissen/work-4.jpg",
      "/instructors/cameron-nissen/work-5.jpg",
    ],
    socials: {
      artstation: "https://www.artstation.com/cameronnissen",
    },
    isActive: true,
    isNew: false,
    testimonials: [],
    menteeResults: [],
    pricing: { oneOnOne: 375 },
  },
  {
    name: "Nino Vecia",
    slug: "nino-vecia",
    tagline: "Freelance Illustrator and Independent Artist",
    bio: "Nino Vecia is a seasoned freelance illustrator and independent artist who has worked with high-profile clients, including Wizards of the Coast (Magic: The Gathering, Dungeons and Dragons), Blizzard Entertainment, and more.",
    specialties: ["Illustration", "Character Design", "Fantasy Art"],
    background: ["Gaming", "Indie"],
    profileImageUrl: "/instructors/nino-vecia/profile.jpg",
    portfolioImages: [
      "/instructors/nino-vecia/work-1.png",
      "/instructors/nino-vecia/work-2.png",
      "/instructors/nino-vecia/work-3.png",
      "/instructors/nino-vecia/work-4.png",
      "/instructors/nino-vecia/work-5.png",
    ],
    socials: {
      website: "https://ninovecia.com",
    },
    isActive: true,
    isNew: false,
    testimonials: [],
    menteeResults: [],
    pricing: { oneOnOne: 475 },
  },
  {
    name: "Oliver Titley",
    slug: "oliver-titley",
    tagline: "Concept Artist, Filmmaker, and YouTuber",
    bio: "Ollie is a concept artist, filmmaker, and YouTuber, with over 6 years of games industry experience working at Paradox Interactive on the Age of Wonders series, and with a successful and rapidly growing YouTube channel.",
    specialties: ["Concept Art", "World-building", "Game Development", "Content Creation"],
    background: ["Gaming", "Indie"],
    profileImageUrl: "/instructors/oliver-titley/profile.png",
    portfolioImages: [
      "/instructors/oliver-titley/work-1.png",
      "/instructors/oliver-titley/work-2.jpg",
      "/instructors/oliver-titley/work-3.png",
    ],
    socials: {
      artstation: "https://www.artstation.com/olliejoet",
      patreon: "https://www.patreon.com/KappaTurtleWorld",
      youtube: "https://www.youtube.com/@KappaTurtle",
    },
    isActive: true,
    isNew: false,
    testimonials: [
      {
        name: "egitlin",
        text: "A month of mentoring was an impulse purchase that I don't regret. When I saw that Oliver was offering tutoring, I jumped at the chance because I knew he could teach me creature design, something I'd been trying and failing to learn on my own. I got that and more! In addition to giving me a run down on how creatures are designed in which I learned things I could tell are mainly passed down in a professional setting, he also quickly identified changes I could make to improve old art and to use going forward.\n\nOliver mentioned when things he was teaching me were also things one of his mentors taught him, and I found it really beautiful to be in a chain of information passed down from artist to artist. I can absolutely recommend Oliver!",
      },
    ],
    menteeResults: [],
    pricing: { oneOnOne: 400 },
  },
  {
    name: "Malina Dowling",
    slug: "malina-dowling",
    tagline: "Midwest-based Independent Watercolor Artist",
    bio: "Malina Dowling is a Midwest-based independent artist that works primarily in watercolors. She has traveled the country working and learning the ins and outs of the convention circuit for the better part of a decade.",
    specialties: ["Watercolor", "Traditional Art", "Convention Art"],
    background: ["Indie"],
    profileImageUrl: "/instructors/malina-dowling/profile.jpg",
    portfolioImages: [
      "/instructors/malina-dowling/work-1.jpg",
      "/instructors/malina-dowling/work-2.jpg",
      "/instructors/malina-dowling/work-3.jpg",
      "/instructors/malina-dowling/work-4.jpg",
      "/instructors/malina-dowling/work-5.jpg",
      "/instructors/malina-dowling/work-6.jpg",
    ],
    socials: {
      instagram: "https://www.instagram.com/malinadowling",
    },
    isActive: false,
    isNew: false,
    testimonials: [],
    menteeResults: [],
    pricing: { oneOnOne: 375 },
  },
  {
    name: "Rakasa",
    slug: "rakasa",
    tagline: "Self-Taught Freelance Illustrator",
    bio: "Rakasa is a self-taught freelance illustrator who decided in 2023 to pursue her passion for art full-time, focusing on creating stunning digital illustrations and character designs. She has worked with top-tier clients including Clip Studio Paint, AFK Journey, and Infinity Nikki, bringing her unique artistic vision to major projects in the gaming and software industries.",
    specialties: ["Digital Illustration", "Character Design", "Self-Taught Journey"],
    background: ["Indie"],
    profileImageUrl: "/instructors/rakasa/profile.jpg",
    portfolioImages: [
      "/instructors/rakasa/work-5.jpg",
      "/instructors/rakasa/work-2.jpg",
      "/instructors/rakasa/work-6.jpg",
      "/instructors/rakasa/work-4.jpg",
    ],
    socials: {
      instagram: "https://www.instagram.com/rakasa_art",
    },
    isActive: true,
    isNew: false,
    testimonials: [
      {
        name: "Kell",
        text: "I've been working with Rakasa for just over a month now and it's been incredible. I've learned so much in such a short period of time that has really helped me improve as an artist - learning new techniques on painting, things to consider with composition, lighting, and color. Each lesson I learn something valuable, new, and get the chance to implement it into practice in a piece that I've been wanting to do! I think the aspect I am most pleased with having a mentor to hold me accountable to completing pieces. My portfolio has grown to feature works I'm incredibly of proud and far surpassed my previous art in just a month. All this to say I highly recommend working with her and she's an absolute blast to be around - I'm always looking forward to my lessons!",
      },
      {
        name: "Persi",
        text: "I started Rakasa's mentorship because I'd admired her work for years and felt stuck in a place of wanting to improve my illustration skills but being overwhelmed with resources on where to start. Rakasa is very patient and her teaching methods are incredible and have been very trans-formative in my work within just a few weeks of having her as a mentor. I cannot recommend Rakasa enough as a mentor and have already expressed as much to anyone who will listen. :)",
      },
      {
        name: "aurora",
        text: "Rakasa is the BEST mentor. I made it my mission to learn how to draw portraits and more complex compositions. When I saw that one of my favorite artists was offering a mentorship, I immediately jumped at the opportunity. She is very thorough in her lessons and can break down seemingly complex topics effectively. Her critiques on the homework and artwork are also very detailed, and I learn just as much from the critiques as from the actual lessons. She is also available for questions and advice between lessons when I need guidance on the homework. As a fellow self-taught artist, she was able to relate to my struggles of trying to improve and helped guide me on how to improve my technical skills. She is a wealth of knowledge on the art business as well. I've been mentoring with her for almost four months, and every penny is worth it. She is super kind, funny, and engaging, and I",
      },
      {
        name: "Kell",
        text: "I've been working with Rakasa for the past few months and the artistic improvement I've seen in such a small amount of time is nothing short of astronomical. She continually pushes me to tackle tough concepts and studies that I can turn into full pieces and provides excellent feedback that can elevate me to the next level within my own art. It as if when we meet, I recognize that I have hit a wall in a piece and she helps me navigate around or break through it. With her guidance, I never feel stuck and am in a constant cycle of improvement. I find that I am more much confident to tackle larger pieces, I have clear goals with my art and am gearing up to send some pieces over to a few clients for freelancing gigs. I intend to fully continue with this mentorship and keep push myself along the path to improving as an artist!",
      },
    ],
    menteeResults: [
      {
        imageUrl: "/instructors/rakasa/mentee-before-after/mentee-success-1.jpg",
        studentName: "Mentee Success Story",
      },
      {
        imageUrl: "/instructors/rakasa/mentee-before-after/mentee-success-2.jpg",
        studentName: "Mentee Success Story",
      },
    ],
    pricing: { oneOnOne: 475, group: 250 },
  },
  {
    name: "Amanda Kiefer",
    slug: "amanda-kiefer",
    tagline: "Senior-Level Concept Artist",
    bio: "Amanda Kiefer is a senior-level concept artist with 7+ years of games industry experience creating original characters, environments, weapons and prop concept art for various projects and problem-solving design challenges.",
    specialties: ["Concept Art", "Character Design", "Environment Art", "Prop Design"],
    background: ["Gaming"],
    profileImageUrl: "/instructors/amanda-kiefer/profile.jpg",
    portfolioImages: [
      "/instructors/amanda-kiefer/work-1.jpg",
      "/instructors/amanda-kiefer/work-2.jpg",
    ],
    socials: {
      artstation: "https://www.artstation.com/amandakiefer",
    },
    isActive: true,
    isNew: false,
    testimonials: [
      {
        name: "Joshua",
        text: "Amanda provided clarity at a time when I truly needed it as an artist. Her capacity to see me, my work, and my aspirations, gave me the confidence to show up week after week. My mentorship assignments provided steady, yet manageable challenge and Amanda authored flexible assignments to meet that pace. I'd encourage anyone looking to sharpen their artistic selves to be Amanda's mentee.",
      },
    ],
    menteeResults: [],
    pricing: { oneOnOne: 375 },
  },
  {
    name: "Neil Gray",
    slug: "neil-gray",
    tagline: "Concept Artist Specializing in Character, Armor, and Weaponry",
    bio: "Neil Gray is a concept artist who has worked in the gaming industry and has been rapidly growing on social media for intricate and creative character, armor, and weaponry designs.",
    specialties: ["Concept Art", "Character Design", "Armor Design", "Weaponry"],
    background: ["Gaming", "Indie"],
    profileImageUrl: "/instructors/neil-gray/profile.jpg",
    portfolioImages: [
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
    socials: {
      artstation: "https://www.artstation.com/neilgray",
    },
    isActive: true,
    isNew: false,
    testimonials: [
      {
        name: "Pcomplex",
        text: "It's been a fun and rewarding experience! I've learned about shape design principles I hadn't encountered in previous attempts studying from anatomy books and the feedback has been really useful. It's helped me a lot with how I approach my personal art projects.",
      },
      {
        name: "Anonymous Mentee",
        text: "A down-to-earth instructor who provides solid lessons in basic to advanced skills, as well as valuable workflow and industry insight. Someone who truly cares about his students' learning and artistic growth.",
      },
      {
        name: "Mac",
        text: "NRC Gray gave me deep insights into the core design concepts I'd been missing and struggling with. His critiques were strength-based yet laser-focused on skills I could build independently.\n\nBefore his mentorship, I rarely followed through on drawing ideas. Now, as I write this, I've completed 150 consecutive days of character designs—with dramatic improvement in my grasp of design principles.\n\nAny serious artist would be lucky to learn from his design philosophy",
      },
      {
        name: "diyi",
        text: "I had taken online drawing and painting classes for about four years before finding NRC Gray's Mentorship. I decided to give it a try, and I'm very glad I did. Neil's knowledge and guidance have been incredibly helpful. His sessions have clarified concepts I struggled with before, and I appreciate how direct and clear he is in his feedback. He tells me what I'm doing well and exactly what I need to improve.",
      },
    ],
    menteeResults: [
      {
        imageUrl: "/instructors/neil-gray/mentee-before-after/mentee-success-1.jpg",
        studentName: "Mentee Success Story",
      },
      {
        imageUrl: "/instructors/neil-gray/mentee-before-after/mentee-success-2.jpg",
        studentName: "Mentee Success Story",
      },
      {
        imageUrl: "/instructors/neil-gray/mentee-before-after/mentee-success-3.jpg",
        studentName: "Mentee Success Story",
      },
      {
        imageUrl: "/instructors/neil-gray/mentee-before-after/mentee-success-4.jpg",
        studentName: "Mentee Success Story",
      },
      {
        imageUrl: "/instructors/neil-gray/mentee-before-after/mentee-success-5.jpg",
        studentName: "Mentee Success Story",
      },
    ],
    pricing: { oneOnOne: 460 },
  },
  {
    name: "Ash Kirk",
    slug: "ash-kirk",
    tagline: "Illustrator, Concept Artist, UI Artist, and Graphic Designer",
    bio: "Ash Kirk is an illustrator, concept artist, UI artist, and graphic designer with over a decade of experience as a professional artist with experience with licenses such as Guild Wars 2, Star Wars, HBO, and more.",
    specialties: ["Illustration", "Concept Art", "UI Art", "Graphic Design"],
    background: ["Gaming", "TV", "Film"],
    profileImageUrl: "/instructors/ash-kirk/profile.jpg",
    portfolioImages: [
      "/instructors/ash-kirk/work-1.jpg",
      "/instructors/ash-kirk/work-2.jpg",
      "/instructors/ash-kirk/work-3.jpg",
      "/instructors/ash-kirk/work-4.jpg",
    ],
    socials: {
      twitter: "https://twitter.com/anearbycat",
      bluesky: "https://bsky.app/profile/anearbycat.bsky.social",
    },
    isActive: true,
    isNew: false,
    testimonials: [
      {
        name: "ChrisJ",
        text: "Ash is an excellent and kind mentor who goes above and beyond for their mentees. They have a wide breadth of knowledge whether that be character/shape design, composition, anatomy, etc and they know how to break down these topics to be understandable. I highly recommend Ash as they helped me improve tremendously in only a few months.",
      },
      {
        name: "Gomlsauce",
        text: "Ash is very diligent and puts a lot of effort into the mentorship and works with you depending on your goals, worth",
      },
      {
        name: "Amanda",
        text: "Ash is an awesome mentor. Very kind, but also firm on what you need to work on as an artist. I've found them incredibly knowledgeable on a wide variety of topics. I'm on my third month with Ash, how much my art has changed for the better is crazy.",
      },
      {
        name: "tanner",
        text: "ASH IS AWESOME. My first month with her is nearing to a close and they're one of my favorite people ever. Her homework pushes me to do things I never would've thought to do as a previous solo study sort of student.\n\nI learned that having a sense of community and someone to talk to about my art goals helps a ton! Not necessarily holding my hand mind you, but giving me guidance and feedback which I've desperately sought out for a long time so finally having a source of that is life changing",
      },
      {
        name: "Subu",
        text: "Ash is an excellent mentor. They consistently made sure to listen to my personal goals and aspirations as an artist and gave me both daily mini assignments to tackle my weaknesses.\n\nIn addition to this, they gave me a manageable number of relevant and realistic weekly projects that they would go over in depth, and show me how to improve my work by showing me visually, by performing live demonstrations during class.\n\nAll of their critiques were honest and firm, but always was kind and respectful. Most importantly, any questions about problems I had along the way that were bothering me before each session they would also go above and beyond with written responses that were timely, honest, and helpful.",
      },
      {
        name: "Wroclawed",
        text: "I can definitely say that being directly taught by someone who's been in the industry really put a lot of the pieces together that I was missing.\n\nI've honestly learned so much more in these two months than I have than my 4 years at school",
      },
      {
        name: "Zack",
        text: "Ash's one-on-one mentorship helped me tackle challenges I didn't realize I was facing in my art development.\n\nTheir educational style was incredibly informative and helpful, they kept contact and provided great feedback and criticism that went a long way. I'm greatful I got to meet them and I can't wait to learn even more.",
      },
      {
        name: "Irida",
        text: "Ash was a wonderful mentor and an extremely passionate and kind person.\n\nThe way she is working with color is quite unique and it made me understand how enjoyable working with colors can be, challenging me to try new things in the field of painting and introducing me to new tools I never tried before!\n\nShe helped me move forward in my character design work and also introduced me to new techniques on how to polish my ideas further.\n\nIt was a wonderful experience overall and I am very happy to have had the opportunity to meet and work with Ash in this period of time .",
      },
      {
        name: "Jarell",
        text: "Ash is a very talented mentor. We've worked together in two stints now. We started in 2023 for a couple of months and we've worked in 2025 for a couple of months. Both instances have been amazing. The level of personalized assignments, weakness drills, painting tutoring and resource management training is far above any class I've taken in the past. I'm always taken to my absolute limit and surprise myself with the quality and quantity I can get done in a week.\n\nI've taken many classes online with feedback from CGMA, and Ash has pushed me much farther in much less time. I look forward to working with Ash again after I've hit a new plateau, so we can break through that one together as well.",
      },
    ],
    menteeResults: [],
    pricing: { oneOnOne: 375 },
  },
  {
    name: "Andrea Sipl",
    slug: "andrea-sipl",
    tagline: "Illustrator, Oil Painter, UI Artist, and Gaming Art Designer",
    bio: "Andrea is an illustrator, oil painter, UI artist, and gaming art designer, who leverages over 16 years of professional experience. She's collaborated with licenses such as ARCHER, Coca-Cola, and FX Networks.",
    specialties: ["Illustration", "Oil Painting", "UI Art", "Game Design"],
    background: ["Gaming", "TV", "Indie"],
    profileImageUrl: "/instructors/andrea-sipl/profile.png",
    portfolioImages: [
      "/instructors/andrea-sipl/work-1.png",
      "/instructors/andrea-sipl/work-2.jpg",
      "/instructors/andrea-sipl/work-3.png",
      "/instructors/andrea-sipl/work-4.png",
      "/instructors/andrea-sipl/work-5.jpg",
      "/instructors/andrea-sipl/work-6.jpg",
      "/instructors/andrea-sipl/work-7.jpg",
    ],
    socials: {
      website: "https://www.andreasipl.com",
    },
    isActive: true,
    isNew: false,
    testimonials: [
      {
        name: "Faun",
        text: "Andrea is a wealth of knowledge in both the commercial and freelance art worlds. Whatever side of art you want to pursue, she can help guide you in what you need to focus on in order to put together a portfolio to present to potential clients/employers to land a job in the industry. She has skills in both traditional and digital art and is always able to give feedback and tips on how to level up my work in either department.\n\nI've grown in many ways already in the 4 months Ive worked with her and I have more confidence in my abilities. I have more clarity in my areas of strength as well as areas of weakness and have a better idea on how to approach them. She's also just a super sweet and genuine person, and truly cares about her mentees. She is always thinking of ways she can improve her mentorships and give her mentees more opportunities for growth. I'm truly grateful to her for making herself available to others in spite of her already busy schedule, and I look forward to continuing to work with her for as long as I can!",
      },
      {
        name: "Liminal",
        text: "This has been really awesome experience… I have learned more from these sessions than the hours of tutorials and book and classes I have taken…",
      },
      {
        name: "Quinn",
        text: "Having a newer background in art, I expected to go into Andrea's class to brush up on fundamentals and improve. To say I got way more value just my artistic skills than I would've dreamed is an understatement! Andrea taught me how to see things differently, design in a way that makes sense, and use methods that worked for the way that I learned. While the mentorship was fitted to my needs, I also got the value of learning what other students were curious about as well.\n\nShe doesn't pull her punches when she critiques your pieces, but she still somehow says it in a way that's easily digestible and easy to receive. If you're looking for a place where you learn fundamentals, build confidence, and learn different methods of looking at art, Andrea is the perfect mentor!",
      },
      {
        name: "MossyRock",
        text: "I came to Andrea pretty new to painting, feeling rather directionless in how I was supposed to improve. Andrea has worked with me to find what I wanted to do, taught me a large number of techniques, and has been extremely encouraging throughout. I would highly recommend Andreas mentorship and am very grateful for the help and direction that I have been given.",
      },
    ],
    menteeResults: [],
    pricing: { oneOnOne: 300 },
  },
];

export const seedInstructorProfiles = mutation({
  args: {},
  handler: async (ctx) => {
    const results: { instructor: string; profileId: any; testimonials: number; menteeResults: number }[] = [];

    for (const instructor of instructorData) {
      const existingProfile = await ctx.db
        .query("instructorProfiles")
        .withIndex("by_slug", (q) => q.eq("slug", instructor.slug))
        .first();

      let profileId: any;

      if (existingProfile) {
        await ctx.db.patch(existingProfile._id, {
          name: instructor.name,
          tagline: instructor.tagline,
          bio: instructor.bio,
          specialties: instructor.specialties,
          background: instructor.background,
          profileImageUrl: instructor.profileImageUrl,
          portfolioImages: instructor.portfolioImages,
          socials: instructor.socials,
          isActive: instructor.isActive,
          isNew: instructor.isNew,
        });
        profileId = existingProfile._id;
      } else {
        profileId = await ctx.db.insert("instructorProfiles", {
          slug: instructor.slug,
          name: instructor.name,
          tagline: instructor.tagline,
          bio: instructor.bio,
          specialties: instructor.specialties,
          background: instructor.background,
          profileImageUrl: instructor.profileImageUrl,
          portfolioImages: instructor.portfolioImages,
          socials: instructor.socials,
          isActive: instructor.isActive,
          isNew: instructor.isNew,
        });
      }

      let testimonialCount = 0;
      for (const testimonial of instructor.testimonials) {
        const existingTestimonial = await ctx.db
          .query("instructorTestimonials")
          .withIndex("by_instructorId", (q) => q.eq("instructorId", instructor.slug))
          .filter((q) => q.and(
            q.eq(q.field("name"), testimonial.name),
            q.eq(q.field("text"), testimonial.text)
          ))
          .first();

        if (!existingTestimonial) {
          await ctx.db.insert("instructorTestimonials", {
            instructorId: instructor.slug,
            name: testimonial.name,
            text: testimonial.text,
            role: testimonial.role,
          });
          testimonialCount++;
        }
      }

      let menteeResultCount = 0;
      for (const result of instructor.menteeResults) {
        const existingResult = await ctx.db
          .query("menteeResults")
          .withIndex("by_instructorId", (q) => q.eq("instructorId", instructor.slug))
          .filter((q) => q.eq(q.field("imageUrl"), result.imageUrl))
          .first();

        if (!existingResult) {
          await ctx.db.insert("menteeResults", {
            instructorId: instructor.slug,
            imageUrl: result.imageUrl,
            studentName: result.studentName,
            createdAt: Date.now(),
          });
          menteeResultCount++;
        }
      }

      results.push({
        instructor: instructor.name,
        profileId,
        testimonials: testimonialCount,
        menteeResults: menteeResultCount,
      });
    }

    return {
      message: "Seed completed",
      results,
      totalInstructors: instructorData.length,
    };
  },
});

export const seedInstructorsWithProducts = mutation({
  args: {},
  handler: async (ctx) => {
    const results: {
      instructor: string;
      slug: string;
      instructorId: any;
      oneOnOneProductId: any;
      groupProductId: any | null;
      oneOnOneInventory: number;
      groupInventory: number;
    }[] = [];

    for (const instructor of instructorData) {
      const existingInstructor = await ctx.db
        .query("instructors")
        .withIndex("by_slug", (q) => q.eq("slug", instructor.slug))
        .first();

      let instructorId: any;
      let oneOnOneInventory = 3;
      let groupInventory = instructor.pricing.group ? 2 : 0;

      if (existingInstructor) {
        instructorId = existingInstructor._id;
        await ctx.db.patch(existingInstructor._id, {
          name: instructor.name,
          slug: instructor.slug,
          tagline: instructor.tagline,
          bio: instructor.bio,
          background: instructor.background,
          specialties: instructor.specialties,
          profileImageUrl: instructor.profileImageUrl,
          portfolioImages: instructor.portfolioImages,
          socials: instructor.socials,
          isActive: instructor.isActive,
          isNew: instructor.isNew,
          oneOnOneInventory,
          groupInventory,
          maxActiveStudents: 10,
        });
      } else {
        instructorId = await ctx.db.insert("instructors", {
          name: instructor.name,
          slug: instructor.slug,
          tagline: instructor.tagline,
          bio: instructor.bio,
          background: instructor.background,
          specialties: instructor.specialties,
          profileImageUrl: instructor.profileImageUrl,
          portfolioImages: instructor.portfolioImages,
          socials: instructor.socials,
          isActive: instructor.isActive,
          isNew: instructor.isNew,
          oneOnOneInventory,
          groupInventory,
          maxActiveStudents: 10,
        });
      }

      const oneOnOneProductId = await ctx.db.insert("products", {
        mentorId: instructorId,
        title: "1-on-1 Mentorship",
        description: `${instructor.name} - 4-session 1-on-1 mentorship pack`,
        price: instructor.pricing.oneOnOne.toString(),
        currency: "usd",
        sessionsPerPack: 4,
        validityDays: 60,
        mentorshipType: "one-on-one",
        active: instructor.isActive,
      });

      let groupProductId: any = null;
      if (instructor.pricing.group) {
        groupProductId = await ctx.db.insert("products", {
          mentorId: instructorId,
          title: "Group Mentorship",
          description: `${instructor.name} - 4-session group mentorship pack`,
          price: instructor.pricing.group.toString(),
          currency: "usd",
          sessionsPerPack: 4,
          validityDays: 60,
          mentorshipType: "group",
          active: instructor.isActive,
        });
      }

      results.push({
        instructor: instructor.name,
        slug: instructor.slug,
        instructorId,
        oneOnOneProductId,
        groupProductId,
        oneOnOneInventory,
        groupInventory,
      });
    }

    return {
      message: "Seed instructors and products completed",
      results,
      totalInstructors: instructorData.length,
    };
  },
});

export const backfillInstructorProfileMentorIds = mutation({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query("instructorProfiles").collect();
    const results: { slug: string; mentorId: string | null }[] = [];

    for (const profile of profiles) {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_slug", (q) => q.eq("slug", profile.slug))
        .first();

      if (instructor) {
        await ctx.db.patch(profile._id, {
          mentorId: instructor._id.toString(),
        });
        results.push({ slug: profile.slug, mentorId: instructor._id.toString() });
      } else {
        results.push({ slug: profile.slug, mentorId: null });
      }
    }

    return {
      message: "Backfill completed",
      results,
      totalProfiles: profiles.length,
    };
  },
});

export const clearInstructorsAndProducts = mutation({
  args: { confirm: v.boolean() },
  handler: async (ctx, args) => {
    if (!args.confirm) {
      return { message: "Please pass confirm: true to actually clear data" };
    }

    const instructors = await ctx.db.query("instructors").collect();
    for (const instructor of instructors) {
      await ctx.db.delete(instructor._id);
    }

    const products = await ctx.db.query("products").collect();
    for (const product of products) {
      await ctx.db.delete(product._id);
    }

    return {
      message: "Cleared instructors and products",
      instructorsDeleted: instructors.length,
      productsDeleted: products.length,
    };
  },
});

export const clearInstructorData = mutation({
  args: { confirm: v.boolean() },
  handler: async (ctx, args) => {
    if (!args.confirm) {
      return { message: "Please pass confirm: true to actually clear data" };
    }

    const profiles = await ctx.db.query("instructorProfiles").collect();
    for (const profile of profiles) {
      await ctx.db.delete(profile._id);
    }

    const testimonials = await ctx.db.query("instructorTestimonials").collect();
    for (const testimonial of testimonials) {
      await ctx.db.delete(testimonial._id);
    }

    const results = await ctx.db.query("menteeResults").collect();
    for (const result of results) {
      await ctx.db.delete(result._id);
    }

    return {
      message: "Cleared all instructor data",
      profilesDeleted: profiles.length,
      testimonialsDeleted: testimonials.length,
      menteeResultsDeleted: results.length,
    };
  },
});