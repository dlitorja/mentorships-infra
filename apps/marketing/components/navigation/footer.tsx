import Link from "next/link";

export function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="grid gap-12 md:grid-cols-3">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold uppercase tracking-wider text-white">Huckleberry Art</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connecting artists with world-class instructors for personalized mentorship
              experiences.
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white">Explore</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link
                  href="/instructors"
                  className="text-muted-foreground hover:text-white transition-colors"
                >
                  Browse Instructors
                </Link>
              </li>
              <li>
                <Link
                  href="/#how-it-works"
                  className="text-muted-foreground hover:text-white transition-colors"
                >
                  How it works
                </Link>
              </li>
              <li>
                <Link
                  href="/#testimonials"
                  className="text-muted-foreground hover:text-white transition-colors"
                >
                  Testimonials
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white">Contact</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <a
                  href="mailto:support@huckleberry.art"
                  className="text-muted-foreground hover:text-white transition-colors"
                >
                  support@huckleberry.art
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Huckleberry Art. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
