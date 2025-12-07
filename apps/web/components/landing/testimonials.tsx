import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Quote } from "lucide-react";

const testimonials = [
  {
    name: "Sarah Chen",
    role: "Freelance Illustrator",
    content:
      "Working with my instructor helped me land my first game studio contract. The personalized feedback on my portfolio was invaluable, and the 1-on-1 sessions gave me the confidence to pursue my goals.",
  },
  {
    name: "Marcus Rodriguez",
    role: "Aspiring Concept Artist",
    content:
      "The mentorship program exceeded my expectations. My instructor's industry experience and practical advice helped me understand what studios are really looking for. I've seen huge improvements in my work.",
  },
  {
    name: "Emma Thompson",
    role: "Independent Artist",
    content:
      "As someone transitioning from traditional to digital art, the guidance I received was exactly what I needed. The flexible scheduling made it easy to fit sessions around my work, and the group sessions were a great way to learn from peers too.",
  },
];

export function Testimonials(): JSX.Element {
  return (
    <section className="py-20 px-4 bg-muted/30">
      <div className="mx-auto max-w-7xl">
        <div className="mb-12 text-center">
          <div className="inline-block px-8 py-6 rounded-2xl bg-black/60 backdrop-blur-sm">
            <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              What Students Say
            </h2>
            <p className="mt-4 text-lg text-white/90">
              Hear from artists who've grown their skills with our instructors
            </p>
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {testimonials.map((testimonial, index) => (
            <Card key={index} className="border-2">
              <CardHeader>
                <Quote className="h-8 w-8 text-primary/50" />
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-base leading-relaxed">
                  "{testimonial.content}"
                </p>
                <div>
                  <p className="font-semibold">{testimonial.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {testimonial.role}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

