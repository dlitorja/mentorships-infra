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
      "Purchase a 4-session pack and schedule your mentorship sessions at times that work for you. Sessions are flexible and tailored to your learning goals.",
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
          <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
            How It Works
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Get started with mentorship in three simple steps
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <Card key={index} className="border-2">
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
      </div>
    </section>
  );
}

