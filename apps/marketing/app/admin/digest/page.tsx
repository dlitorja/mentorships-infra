import { requireAdmin } from "@/lib/auth";
import { DigestSettingsForm } from "@/components/admin/digest-settings-form";
import { ErrorBoundary } from "@/components/admin/error-boundary";

export default async function DigestSettingsPage(): Promise<React.ReactElement> {
  await requireAdmin();

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold mb-2">Digest Settings</h1>
      <p className="text-muted-foreground mb-8">
        Configure digest emails with waitlist statistics and insights
      </p>
      <ErrorBoundary fallback={<div>Error loading digest settings.</div>}>
        <DigestSettingsForm />
      </ErrorBoundary>
    </div>
  );
}
