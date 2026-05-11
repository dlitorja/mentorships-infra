import { SignIn } from "@clerk/nextjs";

export default function AdminSignInPage() {
  return (
    <SignIn
      routing="path"
      path="/admin/sign-in"
      signUpUrl="/sign-up"
      fallbackRedirectUrl="/admin"
    />
  );
}