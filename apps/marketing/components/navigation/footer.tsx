import Link from "next/link";

export function Footer(): React.JSX.Element {
  return (
    <footer className="border-t bg-muted/30">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-3">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Huckleberry Art</h3>
            <p className="text-sm text-muted-foreground">
              Connecting artists with world-class instructors for personalized mentorship
              experiences.
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Explore</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href="/instructors"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Browse Instructors
                </Link>
              </li>
              <li>
                <Link
                  href="/#how-it-works"
                  className="text-muted-foreground hover:text-foreground"
                >
                  How it works
                </Link>
              </li>
              <li>
                <Link
                  href="/#testimonials"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Testimonials
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Contact</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="mailto:support@huckleberry.art"
                  className="text-muted-foreground hover:text-foreground"
                >
                  support@huckleberry.art
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t pt-8 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Huckleberry Art. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
