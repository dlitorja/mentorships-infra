const testimonials = [
  {
    name: "Delia Williams",
    quote:
      "The mentorship was exactly what I needed after I graduated from college. I had a loss sense of confidence in myself and the direction in my art. But this mentorship has really helped guide me to see what style and voice naturally came out. It wasn\u2019t about what\u2019s wrong or bad with you, it\u2019s about what you\u2019re doing really well in and how can we take advantage on that more.",
    link: "https://sites.google.com/view/delia-williams/home",
  },
  {
    name: "Jake Posh",
    quote:
      "After college I drifted between all types of art styles and my portfolio was a jumbled mess. Being a mentee to Pete really brought purpose and direction to my art. We found out together what type of art I wanted to do, and that was more important than anything I learned in art school. Expect to work a lot at it, but also expect to get even more out of it than you think.",
    link: "https://www.artstation.com/ub3600b64",
  },
];

export function Testimonials() {
  return (
    <section className="bg-white py-20 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
            What Students Say
          </h2>
          <p className="mt-4 text-gray-500">
            Hear from artists who&apos;ve grown their skills with our instructors
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2">
          {testimonials.map((testimonial) => (
            <div
              key={testimonial.name}
              className="border-l-4 border-[#7c3aed] bg-gray-50 p-8"
            >
              <blockquote className="text-lg leading-relaxed text-[#1a1a2e]">
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>
              <div className="mt-6">
                <a
                  href={testimonial.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[#1a1a2e] hover:text-[#7c3aed] transition-colors"
                >
                  {testimonial.name}
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}