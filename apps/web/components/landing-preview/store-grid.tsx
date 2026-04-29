import Image from "next/image";

type StoreItem = {
  id: string;
  title: string;
  image: string;
  link: string;
};

// Static showcase grid for recordings/courses. Prices intentionally omitted
// because we don't have a reliable source from Kajabi here.
const STORE_ITEMS: StoreItem[] = [
  {
    id: "bundle",
    title: "Special Course Bundle",
    image: "/images/preview/sale-bundle.jpg",
    link: "https://home.huckleberry.art/resource_redirect/offers/gkAXKN2g",
  },
  {
    id: "new-course-1",
    title: "New Course Launch",
    image: "/images/preview/sale-new-course-1.jpg",
    link: "https://home.huckleberry.art/resource_redirect/landing_pages/2151951362",
  },
  {
    id: "discount-58",
    title: "58% Off Featured Course",
    image: "/images/preview/sale-new-course-2.jpg",
    link: "https://home.huckleberry.art/resource_redirect/landing_pages/2151610810",
  },
  {
    id: "drawing-course",
    title: "Drawing from Imagination",
    image: "/images/preview/sale-drawing-course.jpg",
    link: "https://home.huckleberry.art/resource_redirect/landing_pages/2150836416",
  },
  {
    id: "mentor-kim",
    title: "1-on-1 Mentorships: Kim Myatt",
    image: "/images/preview/mentor-kim-myatt.jpg",
    link: "https://mentorships.huckleberry.art",
  },
  {
    id: "discord-community",
    title: "Discord Community & Free Events",
    image: "/images/preview/discord-banner.jpg",
    link: "https://discord.gg/4DqDyKZyA8",
  },
];

export function StoreGrid() {
  return (
    <section className="bg-white py-20 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
            Visit the Store for Recordings and Videos
          </h2>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {STORE_ITEMS.map((item) => (
            <a
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group block overflow-hidden bg-white border border-gray-200 hover:border-[#7c3aed]/50 transition-colors"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-gray-100">
                <Image
                  src={item.image}
                  alt={item.title}
                  fill
                  className="object-cover transition-transform group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
              </div>
              <div className="p-4">
                <h3 className="text-base font-semibold text-[#1a1a2e] group-hover:text-[#7c3aed] transition-colors line-clamp-2">
                  {item.title}
                </h3>
              </div>
            </a>
          ))}
        </div>

        <div className="mt-10 text-center">
          <a
            href="https://mentorships.huckleberry.art"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-[#7c3aed] hover:text-[#6d28d9] font-semibold text-sm uppercase tracking-wider"
          >
            Check Out Our Mentorships →
          </a>
        </div>
      </div>
    </section>
  );
}
