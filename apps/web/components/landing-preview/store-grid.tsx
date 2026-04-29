"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePublicInstructors } from "@/lib/queries/convex/use-instructors";

type Instructor = {
  _id: string;
  name?: string;
  slug?: string;
  tagline?: string;
  profileImageUrl?: string;
  isHidden?: boolean;
};

const MUST_INCLUDE = ["kim myatt", "neil gray", "ash kirk", "rakasa", "nino vecia"];

export function StoreGrid() {
  const { data, isLoading, isError } = usePublicInstructors();
  const [instructors, setInstructors] = useState<Instructor[]>([]);

  useEffect(() => {
    if (!data) return;
    const visible: Instructor[] = (data as any[]).filter((i) => !i.isHidden);

    const byName = new Map<string, Instructor>();
    for (const i of visible) {
      if (!i.name) continue;
      byName.set(i.name.toLowerCase(), i);
    }

    const includeSet: Instructor[] = [];
    for (const key of MUST_INCLUDE) {
      const match = Array.from(byName.values()).find((i) => i.name?.toLowerCase().includes(key));
      if (match && !includeSet.find((m) => m._id === match._id)) includeSet.push(match);
    }

    // Fill the rest with random others, avoiding duplicates
    const others = visible.filter((i) => !includeSet.find((m) => m._id === i._id));
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }

    const combined = [...includeSet, ...others].slice(0, 9); // show up to 9 cards
    setInstructors(combined);
  }, [data]);

  const content = useMemo(() => {
    if (isError) return { title: "1-on-1 mentorships available", items: [] as Instructor[] };
    if (isLoading) return { title: "1-on-1 mentorships available", items: [] as Instructor[] };
    return { title: "1-on-1 mentorships available", items: instructors };
  }, [isError, isLoading, instructors]);

  return (
    <section className="bg-white py-20 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">{content.title}</h2>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {content.items.length === 0 && (
            <div className="col-span-full text-center text-gray-500">Loading mentors...</div>
          )}
          {content.items.map((inst) => (
            <Link
              key={inst._id}
              href={`/instructors/${inst.slug}`}
              className="group block overflow-hidden bg-white border border-gray-200 hover:border-[#7c3aed]/50 transition-colors"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-white">
                <Image
                  src={inst.profileImageUrl || "/placeholder.jpg"}
                  alt={inst.name ?? "Instructor"}
                  fill
                  className="object-contain transition-transform group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
                <div className="absolute top-3 left-3">
                  <span className="inline-block bg-[#dc2626] px-3 py-1 text-xs sm:text-sm font-semibold text-white shadow">
                    MENTORSHIPS
                  </span>
                </div>
              </div>
              <div className="p-4">
                <h3 className="text-base font-semibold text-[#1a1a2e] group-hover:text-[#7c3aed] transition-colors line-clamp-2">
                  {inst.name}
                </h3>
                {inst.tagline && (
                  <p className="mt-1 text-sm text-gray-500 line-clamp-2">{inst.tagline}</p>
                )}
              </div>
            </Link>
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
