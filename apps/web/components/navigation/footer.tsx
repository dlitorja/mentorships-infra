import Link from "next/link";
import Image from "next/image";

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="space-y-4">
            <div className="relative h-10 w-auto" style={{ width: '72px' }}>
              <Image
                src="/logo_bad2.png"
                alt="Huckleberry Art"
                fill
                style={{ objectFit: 'contain' }}
                className="brightness-0 invert"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Connecting artists with world-class instructors for personalized mentorship experiences.
            </p>
          </div>
          
          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Platform</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/instructors" className="text-white/80 hover:text-white transition-colors">
                  Browse Instructors
                </Link>
              </li>
              <li>
                <a href="https://home.huckleberry.art/store" target="_blank" rel="noopener noreferrer" className="text-white/80 hover:text-white transition-colors">
                  Courses
                </a>
              </li>
              <li>
                <Link href="/sign-up" className="text-white/80 hover:text-white transition-colors">
                  Get Started
                </Link>
              </li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Community</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <a href="https://discord.gg/4DqDyKZyA8" target="_blank" rel="noopener noreferrer" className="text-white/80 hover:text-white transition-colors">
                  Discord
                </a>
              </li>
              <li>
                <a href="https://www.instagram.com/huckleberry.art/" target="_blank" rel="noopener noreferrer" className="text-white/80 hover:text-white transition-colors">
                  Instagram
                </a>
              </li>
              <li>
                <a href="https://www.youtube.com/@huckleberryart" target="_blank" rel="noopener noreferrer" className="text-white/80 hover:text-white transition-colors">
                  YouTube
                </a>
              </li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Legal</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/privacy-policy" className="text-white/80 hover:text-white transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms-of-service" className="text-white/80 hover:text-white transition-colors">
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-border text-center">
          <p className="text-sm text-muted-foreground">&copy; {new Date().getFullYear()} Huckleberry Art. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
