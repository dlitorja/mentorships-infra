import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export function LegalLayout({ title, lastUpdated, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="container mx-auto px-4 py-16 max-w-4xl">
        <div className="mb-8">
          <Button asChild variant="ghost" className="mb-6 text-muted-foreground hover:text-foreground">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Home
            </Link>
          </Button>
          <h1 className="text-4xl font-bold text-white mb-2">{title}</h1>
          <p className="text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
        </div>
        <div className="prose prose-invert prose-sm max-w-none space-y-8">
          {children}
        </div>
      </main>
    </div>
  );
}