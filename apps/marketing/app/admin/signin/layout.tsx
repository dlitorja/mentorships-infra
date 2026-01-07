import { SignIn } from "@clerk/nextjs";

export default function AdminSignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <SignIn
        routing="path"
        path="/admin/signin"
        signUpUrl="/admin/signup"
        afterSignInUrl="/admin"
      />
    </div>
  );
}
