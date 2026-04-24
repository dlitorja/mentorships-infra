import { BookOpen, Calendar, Users } from "lucide-react";

const steps = [
  {
    icon: BookOpen,
    title: "Choose Your Instructor",
    description:
      "Browse our diverse roster of professional artists from gaming, TV, film, and independent studios. Each instructor brings unique expertise and real-world experience.",
  },
  {
    icon: Calendar,
    title: "Book Your Sessions",
    description:
      "Purchase a 4-session pack and select a recurring day of the week and time that works for you and your instructor. Sessions happen at the same day and time each week.",
  },
  {
    icon: Users,
    title: "Grow Your Skills",
    description:
      "Receive personalized feedback, portfolio reviews, and guidance from industry professionals. Whether 1-on-1 or group sessions, we\u2019re here to help you succeed.",
  },
];

export function HowItWorks() {
  return (
    <section className="bg-[#0f1117] py-20 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            How It Works
          </h2>
          <p className="mt-4 text-[#a0a0b0]">
            Get started with mentorship in three simple steps
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className="rounded-lg border-t-2 border-[#7c3aed] bg-[#161822] p-8"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#7c3aed]/10">
                  <Icon className="h-6 w-6 text-[#7c3aed]" />
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7c3aed] text-white text-sm font-bold">
                    {index + 1}
                  </span>
                  <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                </div>
                <p className="text-[#a0a0b0] leading-relaxed text-sm">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-xs text-[#6b6b80]">
          * Sessions can be rescheduled, but we encourage keeping them at the same day of the week and time for consistency.
        </p>
      </div>
    </section>
  );
}