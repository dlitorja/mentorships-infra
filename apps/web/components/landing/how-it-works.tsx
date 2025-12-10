import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      "Purchase a 4-session pack and select a recurring day of the week and time that works for you and your instructor. Sessions happen at the same day and time each week.*",
  },
  {
    icon: Users,
    title: "Grow Your Skills",
    description:
      "Receive personalized feedback, portfolio reviews, and guidance from industry professionals. Whether 1-on-1 or group sessions, we're here to help you succeed.",
  },
];

export function HowItWorks() {
  return (
    <section className="py-20 px-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-12 text-center">
          <div className="inline-block px-8 py-6 rounded-2xl bg-black/60 backdrop-blur-sm">
            <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              How It Works
            </h2>
            <p className="mt-4 text-lg text-white/90">
              Get started with mentorship in three simple steps
            </p>
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <Card key={step.title} className="border-2">
                <CardHeader>
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                      {index + 1}
                    </span>
                    <CardTitle>{step.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    {step.description}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            * Sessions can be rescheduled, but we encourage keeping them at the same day of the week and time for consistency.
          </p>
        </div>
      </div>
    </section>
  );
}

