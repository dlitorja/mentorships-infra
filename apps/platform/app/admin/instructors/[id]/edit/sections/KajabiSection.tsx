'use client';

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ExternalLink } from "lucide-react";
import type { InstructorFormData } from "../types";

interface KajabiSectionProps {
  formData: InstructorFormData;
  setFormData: React.Dispatch<React.SetStateAction<InstructorFormData>>;
  setActiveTab: (tab: string) => void;
}

export function KajabiSection({ formData, setFormData, setActiveTab }: KajabiSectionProps) {
  const [verifyingOneOnOne, setVerifyingOneOnOne] = useState(false);
  const [verifyingGroup, setVerifyingGroup] = useState(false);
  const [verificationResultOneOnOne, setVerificationResultOneOnOne] = useState<{ valid: boolean; message: string } | null>(null);
  const [verificationResultGroup, setVerificationResultGroup] = useState<{ valid: boolean; message: string } | null>(null);

  const verifyUrl = async (url: string): Promise<{ valid: boolean; message: string }> => {
    if (!url) {
      return { valid: false, message: "URL is empty" };
    }

    try {
      const response = await fetch(url, {
        method: "HEAD",
        mode: "no-cors",
      });
      return { valid: true, message: "URL is reachable" };
    } catch {
      try {
        const response = await fetch(url, { method: "GET", mode: "no-cors" });
        return { valid: true, message: "URL is reachable" };
      } catch (e) {
        return { valid: false, message: "Could not verify URL - it may be unreachable or blocked" };
      }
    }
  };

  const handleVerifyOneOnOne = async () => {
    if (!formData.kajabiCheckoutUrlOneOnOne) {
      setVerificationResultOneOnOne({ valid: false, message: "Please enter a URL first" });
      return;
    }
    setVerifyingOneOnOne(true);
    setVerificationResultOneOnOne(null);
    const result = await verifyUrl(formData.kajabiCheckoutUrlOneOnOne);
    setVerificationResultOneOnOne(result);
    setVerifyingOneOnOne(false);
  };

  const handleVerifyGroup = async () => {
    if (!formData.kajabiCheckoutUrlGroup) {
      setVerificationResultGroup({ valid: false, message: "Please enter a URL first" });
      return;
    }
    setVerifyingGroup(true);
    setVerificationResultGroup(null);
    const result = await verifyUrl(formData.kajabiCheckoutUrlGroup);
    setVerificationResultGroup(result);
    setVerifyingGroup(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>External Checkout (Kajabi)</CardTitle>
        <CardDescription>
          Enable Kajabi checkout to redirect purchases to an external Kajabi page instead of the internal Stripe/PayPal flow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-2">
          <Checkbox
            id="useKajabiCheckout"
            checked={formData.useKajabiCheckout}
            onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, useKajabiCheckout: checked === true }))}
          />
          <Label htmlFor="useKajabiCheckout" className="cursor-pointer">Use Kajabi Checkout</Label>
        </div>

        {formData.useKajabiCheckout && (
          <div className="space-y-6">
            <div className="border rounded-lg p-4 space-y-4">
              <div>
                <Label htmlFor="kajabiCheckoutUrlOneOnOne">Kajabi URL for 1-on-1 Mentorship</Label>
                <Input
                  id="kajabiCheckoutUrlOneOnOne"
                  value={formData.kajabiCheckoutUrlOneOnOne}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, kajabiCheckoutUrlOneOnOne: e.target.value }));
                    setVerificationResultOneOnOne(null);
                  }}
                  placeholder="https://your-app.kajabi.com/offers/..."
                />
                <p className="text-xs text-muted-foreground mt-1">The Kajabi checkout URL for 1-on-1 mentorship purchases</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleVerifyOneOnOne}
                  disabled={verifyingOneOnOne || !formData.kajabiCheckoutUrlOneOnOne}
                >
                  {verifyingOneOnOne ? "Verifying..." : "Verify URL"}
                </Button>
                {formData.kajabiCheckoutUrlOneOnOne && (
                  <a
                    href={formData.kajabiCheckoutUrlOneOnOne}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open URL
                  </a>
                )}
              </div>
              {verificationResultOneOnOne && (
                <p className={`text-sm ${verificationResultOneOnOne.valid ? "text-green-600" : "text-amber-600"}`}>
                  {verificationResultOneOnOne.message}
                </p>
              )}
            </div>

            <div className="border rounded-lg p-4 space-y-4">
              <div>
                <Label htmlFor="kajabiCheckoutUrlGroup">Kajabi URL for Group Mentorship</Label>
                <Input
                  id="kajabiCheckoutUrlGroup"
                  value={formData.kajabiCheckoutUrlGroup}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, kajabiCheckoutUrlGroup: e.target.value }));
                    setVerificationResultGroup(null);
                  }}
                  placeholder="https://your-app.kajabi.com/offers/..."
                />
                <p className="text-xs text-muted-foreground mt-1">The Kajabi checkout URL for group mentorship purchases</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleVerifyGroup}
                  disabled={verifyingGroup || !formData.kajabiCheckoutUrlGroup}
                >
                  {verifyingGroup ? "Verifying..." : "Verify URL"}
                </Button>
                {formData.kajabiCheckoutUrlGroup && (
                  <a
                    href={formData.kajabiCheckoutUrlGroup}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open URL
                  </a>
                )}
              </div>
              {verificationResultGroup && (
                <p className={`text-sm ${verificationResultGroup.valid ? "text-green-600" : "text-amber-600"}`}>
                  {verificationResultGroup.message}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={() => setActiveTab("inventory")}>Back</Button>
          <Button onClick={() => setActiveTab("testimonials")}>Next</Button>
        </div>
      </CardContent>
    </Card>
  );
}
