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
    <section className="bg-gray-50 py-20 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
            How It Works
          </h2>
          <p className="mt-4 text-gray-500">
            Get started with mentorship in three simple steps
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className="bg-white border border-gray-200 p-8 hover:border-[#7c3aed]/30 transition-colors"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#7c3aed]/10">
                  <Icon className="h-6 w-6 text-[#7c3aed]" />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7c3aed] text-white text-sm font-bold">
                    {index + 1}
                  </span>
                  <h3 className="text-lg font-semibold text-[#1a1a2e]">{step.title}</h3>
                </div>
                <p className="text-sm text-gray-500 leading-relaxed">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-xs text-gray-400">
          * Sessions can be rescheduled, but we encourage keeping them at the same day of the week and time for consistency.
        </p>
      </div>
    </section>
  );
}