import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound(): React.JSX.Element {
  return (
    <div className="container mx-auto px-4 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight">Instructor not found</h1>
        <p className="mt-4 text-muted-foreground">
          The instructor you’re looking for doesn’t exist (or the link is out of date).
        </p>
        <div className="mt-8 flex justify-center">
          <Button asChild variant="outline">
            <Link href="/instructors">Back to instructors</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
