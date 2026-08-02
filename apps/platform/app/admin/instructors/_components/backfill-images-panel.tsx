"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { backfillInstructorImages } from "@/lib/queries/api-client";

export type BackfillSummary = {
  processedProfiles: number;
  processedInstructors: number;
  processedPortfolioImages: number;
  processedStudentResults: number;
  skipped: number;
  errors: Array<{ kind: string; id: string; message: string }>;
};

type BackfillResponse = { success?: boolean; summary?: BackfillSummary; error?: string };

export function BackfillImagesPanel(): React.ReactElement {
  type BackfillRequest = {
    baseUrl: string;
    includeStudentResults: boolean;
    dryRun: boolean;
    limit?: number;
  };

  const [baseUrl, setBaseUrl] = useState<string>(
    () => (typeof window !== "undefined" ? window.location.origin : "")
  );
  const [isEditingOrigin, setIsEditingOrigin] = useState(false);
  const [includeStudentResults, setIncludeStudentResults] = useState<boolean>(true);
  const [limit, setLimit] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const baseId = React.useId();
  const [currentRunIsDry, setCurrentRunIsDry] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<BackfillSummary | null>(null);
  const [rawResponse, setRawResponse] = useState<BackfillResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ensureBaseUrl = () => baseUrl.trim() || (typeof window !== "undefined" ? window.location.origin : "");

  async function runBackfill(runDry: boolean): Promise<void> {
    try {
      setIsRunning(true);
      setCurrentRunIsDry(runDry);
      setError(null);
      setSummary(null);
      setRawResponse(null);
      const body: BackfillRequest = {
        baseUrl: ensureBaseUrl(),
        includeStudentResults,
        dryRun: runDry,
      };
      const n = parseInt(limit, 10);
      if (!Number.isNaN(n) && n > 0) body.limit = n;
      const json = await backfillInstructorImages(body);
      if (json.error) {
        setError(json.error);
      } else {
        setSummary(json.summary ?? null);
        setRawResponse(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
      setCurrentRunIsDry(null);
      if (!runDry) {
        setConfirmRun(false);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3 items-end">
          <div className="md:col-span-2">
            <Label htmlFor={`${baseId}-origin`} className="block text-sm font-medium mb-1">
              Site Origin
            </Label>
            <div className="flex gap-2 items-center">
              <Input
                id={`${baseId}-origin`}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                readOnly={!isEditingOrigin}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditingOrigin((v) => !v)}
              >
                {isEditingOrigin ? "Lock" : "Edit"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Used to turn relative paths into absolute URLs. Defaults to current site.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${baseId}-include-student-results`}
              checked={includeStudentResults}
              onCheckedChange={(checked) => setIncludeStudentResults(checked === true)}
            />
            <Label htmlFor={`${baseId}-include-student-results`} className="text-sm">
              Include student results
            </Label>
          </div>
        </div>

        <div>
          <Button
            type="button"
            variant="link"
            className="text-sm text-primary hover:underline px-0"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </Button>
          {showAdvanced && (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <Label htmlFor={`${baseId}-limit`} className="block text-sm font-medium mb-1">
                  Batch limit
                </Label>
                <Input
                  id={`${baseId}-limit`}
                  type="number"
                  min={1}
                  placeholder="e.g. 200"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <Button
            type="button"
            disabled={isRunning}
            onClick={() => runBackfill(true)}
            variant="outline"
          >
            {isRunning && currentRunIsDry === true ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Preview
          </Button>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${baseId}-confirm-run`}
              checked={confirmRun}
              onCheckedChange={(checked) => setConfirmRun(checked === true)}
            />
            <Label htmlFor={`${baseId}-confirm-run`} className="text-sm">
              I understand this writes storage IDs to production data
            </Label>
          </div>
          <Button
            type="button"
            disabled={isRunning || !confirmRun}
            onClick={() => runBackfill(false)}
          >
            {isRunning && currentRunIsDry === false ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Run Backfill
          </Button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600" role="alert">{error}</div>}

      {summary && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Stat label="Profiles" value={summary.processedProfiles} />
            <Stat label="Instructors" value={summary.processedInstructors} />
            <Stat label="Portfolio Images" value={summary.processedPortfolioImages} />
            <Stat label="Student Results" value={summary.processedStudentResults} />
            <Stat label="Skipped" value={summary.skipped} />
          </div>

          {summary.errors?.length ? (
            <div>
              <h4 className="font-medium mb-2">Errors ({summary.errors.length})</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2">Type</th>
                      <th className="text-left py-2 px-2">Record</th>
                      <th className="text-left py-2 px-2">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.errors.map((e, i) => (
                      <tr key={i} className="border-b align-top">
                        <td className="py-2 px-2 font-mono text-xs">{e.kind}</td>
                        <td className="py-2 px-2 font-mono text-xs">{e.id}</td>
                        <td className="py-2 px-2 break-all">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => downloadReport(rawResponse)}>
              Download report
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setSummary(null); setRawResponse(null); }}
            >
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function downloadReport(obj: BackfillResponse | null): void {
  if (!obj) return;
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backfill-summary-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
