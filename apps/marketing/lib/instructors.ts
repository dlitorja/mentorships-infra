export interface InstructorOffer {
  kind: "oneOnOne" | "group";
  label: string;
  url: string;
  active?: boolean; // If false, offer will be hidden. Defaults to true if not specified.
}

export interface Testimonial {
  text: string;
  author: string;
  role?: string;
}

export interface Instructor {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  bio: string;
  specialties: string[];
  background: string[];
  profileImage: string;
  workImages: string[];
  pricing?: {
    oneOnOne?: number;
    group?: number;
  };
  offers: InstructorOffer[];
  testimonials?: Testimonial[];
  isNew?: boolean;
  socials?: {
    platform: string;
    url: string;
  }[];
}

const KAJABI_PLACEHOLDER = "https://huckleberryart.kajabi.com/offers/REPLACE_ME";

export const instructors: Instructor[] = [
  {
    id: "jordan-jardine",
    name: "Jordan Jardine",
    slug: "jordan-jardine",
    isNew: true,
    tagline:
      "Toronto-based Freelance Artist Specializing in Digital Painting, Illustration and Concept Art",
    bio: "Jordan Jardine is a Toronto-based freelance artist specializing in digital painting, illustration and concept art. He has worked on the Netflix series 'Tomb Raider: The Legend of Lara Croft' and is currently working on projects focusing on character and environment development as well as 2D asset creation. Having trained traditionally, Jordan has a devout love for the beauty of physical media and seeks to incorporate it into his digital work.",
    specialties: [
      "Digital Painting",
      "Illustration",
      "Concept Art",
      "Character Development",
      "Environment Development",
      "2D Asset Creation",
    ],
    background: ["Freelance", "Indie"],
    socials: [
      {
        platform: "Website",
        url: "https://www.jordanjardine.com"
      }
    ],
    profileImage: "/instructors/jordan-jardine/work-2.jpg",
    workImages: [
      "/instructors/jordan-jardine/work-1.jpg",
      "/instructors/jordan-jardine/work-2.jpg",
      "/instructors/jordan-jardine/work-3.jpg",
    ],
    pricing: { oneOnOne: 400 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/qbekGLEo/checkout",
      },
    ],
  },
  {
    id: "cameron-nissen",
    name: "Cameron Nissen",
    slug: "cameron-nissen",
    isNew: true,
    tagline: "Freelance Illustrator and Concept Artist",
    bio: "Cameron Nissen is a seasoned freelance illustrator and concept artist. Cameron is known for his fast and expressive painterly style and creating both original work and art inspired by popular IPs like Game of Thrones.",
    specialties: ["Illustration", "Concept Art", "Painterly Style"],
background: ["Gaming", "Indie"],
    socials: [
      {
        platform: "Instagram",
        url: "https://www.instagram.com/crookednosedelf/?hl=en"
      }
    ],
    profileImage: "/instructors/cameron-nissen/profile.jpg",
    workImages: [
      "/instructors/cameron-nissen/work-1.jpg",
      "/instructors/cameron-nissen/work-2.jpg",
      "/instructors/cameron-nissen/work-3.jpg",
      "/instructors/cameron-nissen/work-4.jpg",
      "/instructors/cameron-nissen/work-5.jpg",
    ],
    pricing: { oneOnOne: 375 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/xGKxSVJL/checkout",
      },
    ],
  },
  {
    id: "nino-vecia",
    name: "Nino Vecia",
    slug: "nino-vecia",
    tagline: "Freelance Illustrator and Independent Artist",
    bio: "Nino Vecia is a seasoned freelance illustrator and independent artist who has worked with high-profile clients, including Wizards of the Coast (Magic: The Gathering, Dungeons and Dragons), Blizzard Entertainment, and more.",
    specialties: ["Illustration", "Character Design", "Fantasy Art"],
background: ["Gaming", "Indie"],
    socials: [
      {
        platform: "Instagram",
        url: "https://www.instagram.com/ninovecia/?hl=en"
      }
    ],
    profileImage: "/instructors/nino-vecia/profile.jpg",
    workImages: [
      "/instructors/nino-vecia/work-1.png",
      "/instructors/nino-vecia/work-2.png",
      "/instructors/nino-vecia/work-3.png",
      "/instructors/nino-vecia/work-4.png",
      "/instructors/nino-vecia/work-5.png",
    ],
    pricing: { oneOnOne: 475 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/shmUAkoC/checkout",
      },
    ],
  },
  {
    id: "oliver-titley",
    name: "Oliver Titley",
    slug: "oliver-titley",
    tagline: "Concept Artist, Filmmaker, and YouTuber",
    bio: "Ollie is a concept artist, filmmaker, and YouTuber, with over 6 years of games industry experience working at Paradox Interactive on the Age of Wonders series, and with a successful and rapidly growing YouTube channel.",
    specialties: ["Concept Art", "World-building", "Game Development", "Content Creation"],
    background: ["Gaming", "Indie"],
    socials: [
      {
        platform: "YouTube",
        url: "https://www.youtube.com/@KappatheWorldofTurtles-tm6zb/videos"
      }
    ],
    profileImage: "/instructors/oliver-titley/profile.png",
    workImages: [
      "/instructors/oliver-titley/work-1.png",
      "/instructors/oliver-titley/work-2.jpg",
      "/instructors/oliver-titley/work-3.png",
    ],
    pricing: { oneOnOne: 400 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/iSLmoxMk/checkout",
      },
    ],
    testimonials: [
      {
        text: "A month of mentoring was an impulse purchase that I don't regret. When I saw that Oliver was offering tutoring, I jumped at the chance because I knew he could teach me creature design, something I'd been trying and failing to learn on my own. I got that and more! In addition to giving me a run down on how creatures are designed in which I learned things I could tell are mainly passed down in a professional setting, he also quickly identified changes I could make to improve old art and to use going forward.\n\nOliver mentioned when things he was teaching me were also things one of his mentors taught him, and I found it really beautiful to be in a chain of information passed down from artist to artist. I can absolutely recommend Oliver!",
        author: "egitlin",
      },
    ],
  },
  {
    id: "malina-dowling",
    name: "Malina Dowling",
    slug: "malina-dowling",
    tagline: "Midwest-based Independent Watercolor Artist",
    bio: "Malina Dowling is a Midwest-based independent artist that works primarily in watercolors. She has traveled the country working and learning the ins and outs of the convention circuit for the better part of a decade.",
    specialties: ["Watercolor", "Traditional Art", "Convention Art"],
    background: ["Indie"],
    socials: [
      {
        platform: "Instagram",
        url: "https://www.instagram.com/void.bug/"
      }
    ],
    profileImage: "/instructors/malina-dowling/profile.jpg",
    workImages: [
      "/instructors/malina-dowling/work-1.jpg",
      "/instructors/malina-dowling/work-2.jpg",
      "/instructors/malina-dowling/work-3.jpg",
      "/instructors/malina-dowling/work-4.jpg",
      "/instructors/malina-dowling/work-5.jpg",
      "/instructors/malina-dowling/work-6.jpg",
    ],
    pricing: { oneOnOne: 375 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/rEA23xnk/checkout",
      },
    ],
    testimonials: [
      {
        text: "I was seeking guidance for my artistic journey, so I took up a mentorship with Malina. This decision was worth every penny! She nailed down the areas that needed improvement and I've already seen HUGE progress working with her. Highly recommended.",
        author: "Namaera",
      },
    ],
  },
  {
    id: "rakasa",
    name: "Rakasa",
    slug: "rakasa",
    tagline: "Self-Taught Freelance Illustrator",
    bio: "Rakasa is a self-taught freelance illustrator who decided in 2023 to pursue her passion for art full-time, focusing on creating stunning digital illustrations and character designs. She has worked with top-tier clients including Clip Studio Paint, AFK Journey, and Infinity Nikki, bringing her unique artistic vision to major projects in the gaming and software industries.",
    specialties: ["Digital Illustration", "Character Design", "Self-Taught Journey"],
    background: ["Indie"],
    socials: [
      {
        platform: "Instagram",
        url: "https://www.instagram.com/rakasademon/?hl=en"
      }
    ],
    profileImage: "/instructors/rakasa/profile.jpg",
    workImages: [
      "/instructors/rakasa/work-1.jpg",
      "/instructors/rakasa/work-2.jpg",
      "/instructors/rakasa/work-3.jpg",
      "/instructors/rakasa/work-4.jpg",
    ],
    pricing: { oneOnOne: 475, group: 250 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/GgkFAbpC/checkout",
      },
      {
        kind: "group",
        label: "Buy group mentorship",
        url: `${KAJABI_PLACEHOLDER}?instructor=rakasa&type=group`,
        active: false, // Placeholder URL - hide until real URL is available
      },
    ],
    testimonials: [
      {
        text: "I've been working with Rakasa for just over a month now and it's been incredible. I've learned so much in such a short period of time that has really helped me improve as an artist - learning new techniques on painting, things to consider with composition, lighting, and color. Each lesson I learn something valuable, new, and get the chance to implement it into practice in a piece that I've been wanting to do! I think the aspect I am most pleased with having a mentor to hold me accountable to completing pieces. My portfolio has grown to feature works I'm incredibly of proud and far surpassed my previous art in just a month. All this to say I highly recommend working with her and she's an absolute blast to be around - I'm always looking forward to my lessons!",
        author: "Kell",
      },
      {
        text: "I started Rakasa's mentorship because I'd admired her work for years and felt stuck in a place of wanting to improve my illustration skills but being overwhelmed with resources on where to start. Rakasa is very patient and her teaching methods are incredible and have been very trans-formative in my work within just a few weeks of having her as a mentor. I cannot recommend Rakasa enough as a mentor and have already expressed as much to anyone who will listen. :)",
        author: "Persi",
      },
      {
        text: "Rakasa is the BEST mentor. I made it my mission to learn how to draw portraits and more complex compositions. When I saw that one of my favorite artists was offering a mentorship, I immediately jumped at the opportunity. She is very thorough in her lessons and can break down seemingly complex topics effectively. Her critiques on the homework and artwork are also very detailed, and I learn just as much from the critiques as from the actual lessons. She is also available for questions and advice between lessons when I need guidance on the homework. As a fellow self-taught artist, she was able to relate to my struggles of trying to improve and helped guide me on how to improve my technical skills. She is a wealth of knowledge on the art business as well. I've been mentoring with her for almost four months, and every penny is worth it. She is super kind, funny, and engaging, and I",
        author: "aurora",
      },
      {
        text: "I've been working with Rakasa for the past few months and the artistic improvement I've seen in such a small amount of time is nothing short of astronomical. She continually pushes me to tackle tough concepts and studies that I can turn into full pieces and provides excellent feedback that can elevate me to the next level within my own art. It as if when we meet, I recognize that I have hit a wall in a piece and she helps me navigate around or break through it. With her guidance, I never feel stuck and am in a constant cycle of improvement. I find that I am more much confident to tackle larger pieces, I have clear goals with my art and am gearing up to send some pieces over to a few clients for freelancing gigs. I intend to fully continue with this mentorship and keep push myself along the path to improving as an artist!",
        author: "Kell",
      },
    ],
  },
  {
    id: "amanda-kiefer",
    name: "Amanda Kiefer",
    slug: "amanda-kiefer",
    tagline: "Senior-Level Concept Artist",
    bio: "Amanda Kiefer is a senior-level concept artist with 7+ years of games industry experience creating original characters, environments, weapons and prop concept art for various projects and problem-solving design challenges.",
    specialties: ["Concept Art", "Character Design", "Environment Art", "Prop Design"],
    background: ["Gaming"],
    socials: [
      {
        platform: "Instagram",
        url: "https://www.instagram.com/amanda_kiefer_art/?hl=en"
      }
    ],
    profileImage: "/instructors/amanda-kiefer/profile.jpg",
    workImages: [
      "/instructors/amanda-kiefer/work-1.jpg",
      "/instructors/amanda-kiefer/work-2.jpg",
    ],
    pricing: { oneOnOne: 375 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/caWkx6z7/checkout",
      },
    ],
    testimonials: [
      {
        text: "Amanda provided clarity at a time when I truly needed it as an artist. Her capacity to see me, my work, and my aspirations, gave me the confidence to show up week after week. My mentorship assignments provided steady, yet manageable challenge and Amanda authored flexible assignments to meet that pace. I'd encourage anyone looking to sharpen their artistic selves to be Amanda's mentee.",
        author: "Joshua",
      },
    ],
  },
  {
    id: "neil-gray",
    name: "Neil Gray",
    slug: "neil-gray",
    tagline: "Concept Artist Specializing in Character, Armor, and Weaponry",
    bio: "Neil Gray is a concept artist who has worked in the gaming industry and has been rapidly growing on social media for intricate and creative character, armor, and weaponry designs.",
    specialties: ["Concept Art", "Character Design", "Armor Design", "Weaponry"],
    background: ["Gaming", "Indie"],
    socials: [
      {
        platform: "X",
        url: "https://x.com/nrcgray?lang=en"
      }
    ],
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
    pricing: { oneOnOne: 460 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/ADNkiMXF/checkout",
      },
    ],
    testimonials: [
      {
        text: "It's been a fun and rewarding experience! I've learned about shape design principles I hadn't encountered in previous attempts studying from anatomy books and the feedback has been really useful. It's helped me a lot with how I approach my personal art projects.",
        author: "Pcomplex",
      },
      {
        text: "A down-to-earth instructor who provides solid lessons in basic to advanced skills, as well as valuable workflow and industry insight. Someone who truly cares about his students' learning and artistic growth.",
        author: "Anonymous Mentee",
      },
      {
        text: "NRC Gray gave me deep insights into the core design concepts I'd been missing and struggling with. His critiques were strength-based yet laser-focused on skills I could build independently.\n\nBefore his mentorship, I rarely followed through on drawing ideas. Now, as I write this, I've completed 150 consecutive days of character designs—with dramatic improvement in my grasp of design principles.\n\nAny serious artist would be lucky to learn from his design philosophy",
        author: "Mac",
      },
      {
        text: "I had taken online drawing and painting classes for about four years before finding NRC Gray's Mentorship. I decided to give it a try, and I'm very glad I did. Neil's knowledge and guidance have been incredibly helpful. His sessions have clarified concepts I struggled with before, and I appreciate how direct and clear he is in his feedback. He tells me what I'm doing well and exactly what I need to improve.",
        author: "diyi",
      },
    ],
  },
  {
    id: "ash-kirk",
    name: "Ash Kirk",
    slug: "ash-kirk",
    tagline: "Illustrator, Concept Artist, UI Artist, and Graphic Designer",
    bio: "Ash Kirk is an illustrator, concept artist, UI artist, and graphic designer with over a decade of experience as a professional artist with experience with licenses such as Guild Wars 2, Star Wars, HBO, and more.",
    specialties: ["Illustration", "Concept Art", "UI Art", "Graphic Design"],
    background: ["Gaming", "TV", "Film"],
    socials: [
      {
        platform: "Website",
        url: "https://www.jordanjardine.com"
      }
    ],
    profileImage: "/instructors/ash-kirk/profile.jpg",
    workImages: [
      "/instructors/ash-kirk/work-1.jpg",
      "/instructors/ash-kirk/work-2.jpg",
      "/instructors/ash-kirk/work-3.jpg",
      "/instructors/ash-kirk/work-4.jpg",
    ],
    pricing: { oneOnOne: 375 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/kNfA7gtX/checkout",
      },
    ],
    testimonials: [
      {
        text: "Ash is an excellent and kind mentor who goes above and beyond for their mentees. They have a wide breadth of knowledge whether that be character/shape design, composition, anatomy, etc and they know how to break down these topics to be understandable. I highly recommend Ash as they helped me improve tremendously in only a few months.",
        author: "ChrisJ",
      },
      {
        text: "Ash is very diligent and puts a lot of effort into the mentorship and works with you depending on your goals, worth",
        author: "Gomlsauce",
      },
      {
        text: "Ash is an awesome mentor. Very kind, but also firm on what you need to work on as an artist. I've found them incredibly knowledgeable on a wide variety of topics. I'm on my third month with Ash, how much my art has changed for the better is crazy.",
        author: "Amanda",
      },
      {
        text: "ASH IS AWESOME. My first month with her is nearing to a close and they're one of my favorite people ever. Her homework pushes me to do things I never would've thought to do as a previous solo study sort of student.\n\nI learned that having a sense of community and someone to talk to about my art goals helps a ton! Not necessarily holding my hand mind you, but giving me guidance and feedback which I've desperately sought out for a long time so finally having a source of that is life changing",
        author: "tanner",
      },
      {
        text: "Ash is an excellent mentor. They consistently made sure to listen to my personal goals and aspirations as an artist and gave me both daily mini assignments to tackle my weaknesses.\n\nIn addition to this, they gave me a manageable number of relevant and realistic weekly projects that they would go over in depth, and show me how to improve my work by showing me visually, by performing live demonstrations during class.\n\nAll of their critiques were honest and firm, but always was kind and respectful. Most importantly, any questions about problems I had along the way that were bothering me before each session they would also go above and beyond with written responses that were timely, honest, and helpful.",
        author: "Subu",
      },
      {
        text: "I can definitely say that being directly taught by someone who's been in the industry really put a lot of the pieces together that I was missing.\n\nI've honestly learned so much more in these two months than I have than my 4 years at school",
        author: "Wroclawed",
      },
      {
        text: "Ash's one-on-one mentorship helped me tackle challenges I didn't realize I was facing in my art development.\n\nTheir educational style was incredibly informative and helpful, they kept contact and provided great feedback and criticism that went a long way. I'm greatful I got to meet them and I can't wait to learn even more.",
        author: "Zack",
      },
      {
        text: "Ash was a wonderful mentor and an extremely passionate and kind person.\n\nThe way she is working with color is quite unique and it made me understand how enjoyable working with colors can be, challenging me to try new things in the field of painting and introducing me to new tools I never tried before!\n\nShe helped me move forward in my character design work and also introduced me to new techniques on how to polish my ideas further.\n\nIt was a wonderful experience overall and I am very happy to have had the opportunity to meet and work with Ash in this period of time .",
        author: "Irida",
      },
      {
        text: "Ash is a very talented mentor. We've worked together in two stints now. We started in 2023 for a couple of months and we've worked in 2025 for a couple of months. Both instances have been amazing. The level of personalized assignments, weakness drills, painting tutoring and resource management training is far above any class I've taken in the past. I'm always taken to my absolute limit and surprise myself with the quality and quantity I can get done in a week.\n\nI've taken many classes online with feedback from CGMA, and Ash has pushed me much farther in much less time. I look forward to working with Ash again after I've hit a new plateau, so we can break through that one together as well.",
        author: "Jarell",
      },
    ],
  },
  {
    id: "andrea-sipl",
    name: "Andrea Sipl",
    slug: "andrea-sipl",
    tagline: "Illustrator, Oil Painter, UI Artist, and Gaming Art Designer",
    bio: "Andrea is an illustrator, oil painter, UI artist, and gaming art designer, who leverages over 16 years of professional experience. She's collaborated with licenses such as ARCHER, Coca-Cola, and FX Networks.",
    specialties: ["Illustration", "Oil Painting", "UI Art", "Game Design"],
    background: ["Gaming", "TV", "Indie"],
    socials: [
      {
        platform: "Instagram",
        url: "https://www.instagram.com/andrea_sipl/?hl=en"
      }
    ],
    profileImage: "/instructors/andrea-sipl/work-2.jpg",
    workImages: [
      "/instructors/andrea-sipl/work-1.png",
      "/instructors/andrea-sipl/work-2.jpg",
      "/instructors/andrea-sipl/work-3.png",
      "/instructors/andrea-sipl/work-4.png",
      "/instructors/andrea-sipl/work-5.jpg",
      "/instructors/andrea-sipl/work-6.jpg",
      "/instructors/andrea-sipl/work-7.jpg",
    ],
    pricing: { oneOnOne: 300 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/Vrvzf2Xz/checkout",
      },
    ],
    testimonials: [
      {
        text: "Andrea is a wealth of knowledge in both the commercial and freelance art worlds. Whatever side of art you want to pursue, she can help guide you in what you need to focus on in order to put together a portfolio to present to potential clients/employers to land a job in the industry. She has skills in both traditional and digital art and is always able to give feedback and tips on how to level up my work in either department.\n\nI've grown in many ways already in the 4 months Ive worked with her and I have more confidence in my abilities. I have more clarity in my areas of strength as well as areas of weakness and have a better idea on how to approach them. She's also just a super sweet and genuine person, and truly cares about her mentees. She is always thinking of ways she can improve her mentorships and give her mentees more opportunities for growth. I'm truly grateful to her for making herself available to others in spite of her already busy schedule, and I look forward to continuing to work with her for as long as I can!",
        author: "Faun",
      },
      {
        text: "This has been really awesome experience… I have learned more from these sessions than the hours of tutorials and book and classes I have taken…",
        author: "Liminal",
      },
      {
        text: "Having a newer background in art, I expected to go into Andrea's class to brush up on fundamentals and improve. To say I got way more value just my artistic skills than I would've dreamed is an understatement! Andrea taught me how to see things differently, design in a way that makes sense, and use methods that worked for the way that I learned. While the mentorship was fitted to my needs, I also got the value of learning what other students were curious about as well.\n\nShe doesn't pull her punches when she critiques your pieces, but she still somehow says it in a way that's easily digestible and easy to receive. If you're looking for a place where you learn fundamentals, build confidence, and learn different methods of looking at art, Andrea is the perfect mentor!",
        author: "Quinn",
      },
      {
        text: "I came to Andrea pretty new to painting, feeling rather directionless in how I was supposed to improve. Andrea has worked with me to find what I wanted to do, taught me a large number of techniques, and has been extremely encouraging throughout. I would highly recommend Andreas mentorship and am very grateful for the help and direction that I have been given.",
        author: "MossyRock",
      },
    ],
  },
  {
    id: "kimea-zizzari",
    name: "Kimea Zizzari",
    slug: "kimea-zizzari",
    isNew: true,
    tagline: "Professional Multimedia Artist and Tattoo Artist",
    bio: "Kimea Zizzari is a professional multimedia artist and works as a resident tattoo artist in Bern, Switzerland. She has been an explorative creator all her life and has a strong background in clinical, health, and behavioral psychology with a master's degree in the field. She continues to explore creative pursuits as an indie artist and has developed a calling to help other artists find their creative pursuits in life. Kimea is also seasoned in running convention booths and runs booths at 8-12 conventions annually. This can be very helpful for aspiring indies that want to pursue convention circuits.",
    specialties: [
      "Multimedia Art",
      "Tattooing",
      "Convention Circuit",
      "Creative Psychology",
      "Indie Art Business",
    ],
    background: ["Indie"],
    socials: [
      {
        platform: "Instagram",
        url: "https://www.instagram.com/kimeazizzari/"
      }
    ],
    profileImage: "/instructors/kimea-zizzari/profile.jpg",
    workImages: [
      "/instructors/kimea-zizzari/work-1.jpg",
      "/instructors/kimea-zizzari/work-2.jpg",
      "/instructors/kimea-zizzari/work-3.jpg",
    ],
    pricing: { oneOnOne: 400 },
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/nTDoD9XK/checkout",
      },
    ],
  },
  {
    id: "keven-mallqui",
    name: "Keven Mallqui",
    slug: "keven-mallqui",
    isNew: true,
    tagline: "Digital Artist and Illustrator",
    bio: "Keven Mallqui (aka seekevdraw) is a seasoned artist whose creative style has been shaped by many influences of his youth. His portfolio spans iconic IPs such as Transformers, Spawn, Star Wars, Predator, and Marvel and DC universes. Over the years, Keven has built a successful career as a freelance industry artist and is a well-recognized presence on the convention circuit as an established indie creator.",
    specialties: ["Digital Illustration", "Character Design", "Visual Art"],
    background: ["Indie"],
    profileImage: "/instructors/keven-mallqui/profile.jpg",
    workImages: [
      "/instructors/keven-mallqui/work-1.jpg",
      "/instructors/keven-mallqui/work-2.jpg",
      "/instructors/keven-mallqui/work-3.jpg",
    ],
    offers: [
      {
        kind: "oneOnOne",
        label: "Buy 1-on-1 mentorship",
        url: "https://home.huckleberry.art/offers/SZrKzyoT",
      },
    ],
  },
];

export function getInstructorBySlug(slug: string): Instructor | undefined {
  return instructors.find((instructor) => instructor.slug === slug);
}

export function getAlphabeticalInstructors(): Instructor[] {
  return [...instructors].sort((a, b) => a.name.localeCompare(b.name));
}

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
      .map((slug) => instructors.find((inst) => inst.slug === slug))
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

export function getNextInstructor(currentSlug: string): Instructor | undefined {
  return getInstructorNavigation(currentSlug).next;
}

export function getPreviousInstructor(currentSlug: string): Instructor | undefined {
  return getInstructorNavigation(currentSlug).previous;
}
