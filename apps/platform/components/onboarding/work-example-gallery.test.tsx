import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkExampleGallery } from "./work-example-gallery";

/**
 * Gallery behaviour that the old per-thumbnail component did not have:
 * full-size preview, per-image download (`?download=1`), and the
 * "download all" ZIP control.
 */

const apiFetchMock = vi.fn();
vi.mock("@/lib/queries/api-client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const createExportMutate = vi.fn();
const cancelExportMutate = vi.fn();
let exportRows: Array<Record<string, unknown>> = [];
let exportLoading = false;

vi.mock("@/lib/queries/convex/use-onboarding-artwork-exports", () => ({
  useOnboardingArtworkExports: () => ({
    data: exportRows,
    isLoading: exportLoading,
  }),
  useCreateOnboardingArtworkExport: () => ({
    mutate: createExportMutate,
    mutateAsync: createExportMutate,
    isPending: false,
  }),
  useCancelOnboardingArtworkExport: () => ({
    mutate: cancelExportMutate,
    mutateAsync: cancelExportMutate,
    isPending: false,
  }),
}));

// jsdom has no navigation; the download handler appends + clicks an <a>.

const EXAMPLES = [
  { _id: "example_1", fileName: "sketch-one.png", size: 1024 },
  { _id: "example_2", fileName: "sketch-two.jpg", size: 2048 },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  exportRows = [];
  exportLoading = false;
  apiFetchMock.mockImplementation(async (url: string) => ({
    url: url.includes("download=1")
      ? "https://b2.example.com/signed?download=1"
      : "https://b2.example.com/signed",
  }));
});

describe("WorkExampleGallery", () => {
  it("fetches a signed URL per example and renders the thumbnails", async () => {
    render(
      <WorkExampleGallery onboardingId="onboarding_1" examples={EXAMPLES as any} />
    );

    await waitFor(() => {
      expect(screen.getAllByRole("img")).toHaveLength(2);
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    // View URLs never carry the attachment flag.
    for (const call of apiFetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("download=1");
    }
    // Retention disclaimer for reviewers (instructors + admins).
    expect(screen.getByText(/automatically deleted/i)).toBeInTheDocument();
  });

  it("opens a full-size preview when a thumbnail is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkExampleGallery onboardingId="onboarding_1" examples={EXAMPLES as any} />
    );
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: /view sketch-one.png/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain("sketch-one.png");

    // Radix marks the rest of the app aria-hidden, so the lightbox
    // image is the only accessible one. The layout contract that keeps
    // it inside the viewport: the content is an overflow-hidden flex
    // column, the viewer row can shrink (`min-h-0 flex-1`), and the
    // image uses `fill` inside a `relative` wrapper with
    // `object-contain`. jsdom has no layout, so assert the structure
    // rather than a computed size — the previous broken version passed
    // an object-contain check while still rendering at intrinsic size.
    const images = within(dialog).getAllByRole("img");
    expect(images).toHaveLength(1);
    expect(images[0].className).toContain("object-contain");
    expect(images[0].parentElement?.className).toContain("relative");

    const viewer = dialog.querySelector(".min-h-0.flex-1");
    expect(viewer).not.toBeNull();
    expect(viewer?.className).toContain("overflow-hidden");
    expect(viewer?.contains(images[0])).toBe(true);
    expect(dialog.className).toContain("overflow-hidden");
  });

  it("mints an attachment URL before saving a single image", async () => {
    const user = userEvent.setup();
    // Intercept the programmatic anchor click so nothing navigates.
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(
      <WorkExampleGallery onboardingId="onboarding_1" examples={EXAMPLES as any} />
    );
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));

    await user.click(
      screen.getByRole("button", { name: /download sketch-one.png/i })
    );

    await waitFor(() => {
      expect(
        apiFetchMock.mock.calls.some((call) =>
          String(call[0]).includes("download=1")
        )
      ).toBe(true);
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
  });

  it("offers the ZIP export when no export exists yet", async () => {
    const user = userEvent.setup();
    render(
      <WorkExampleGallery onboardingId="onboarding_1" examples={EXAMPLES as any} />
    );

    const button = await screen.findByRole("button", {
      name: /download all \(zip\)/i,
    });
    await user.click(button);

    expect(createExportMutate).toHaveBeenCalledWith({ onboardingId: "onboarding_1" });
  });

  it("shows a download link once the ZIP export completes", async () => {
    exportRows = [
      {
        _id: "export_1",
        status: "completed",
        downloadUrl: "https://b2.example.com/artwork.zip",
        fileCount: 2,
      },
    ];

    render(
      <WorkExampleGallery onboardingId="onboarding_1" examples={EXAMPLES as any} />
    );

    const link = await screen.findByRole("link", { name: /download all \(2\)/i });
    expect(link).toHaveAttribute("href", "https://b2.example.com/artwork.zip");
  });

  it("surfaces a pending export as a progress state with a cancel control", async () => {
    exportRows = [{ _id: "export_pending", status: "processing" }];

    render(
      <WorkExampleGallery onboardingId="onboarding_1" examples={EXAMPLES as any} />
    );

    expect(await screen.findByText(/building zip/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /cancel export/i })
    ).toBeInTheDocument();
  });

  it("hides an expired ZIP link and offers a rebuild instead", async () => {
    exportRows = [
      {
        _id: "export_expired",
        status: "completed",
        downloadUrl: "https://b2.example.com/expired.zip",
        expiresAt: Date.now() - 60_000,
        fileCount: 2,
      },
    ];

    render(
      <WorkExampleGallery onboardingId="onboarding_1" examples={EXAMPLES as any} />
    );

    expect(await screen.findByText(/previous zip expired/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /download all/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download all \(zip\)/i })
    ).toBeInTheDocument();
  });

  it("renders nothing when there are no examples", () => {
    const { container } = render(
      <WorkExampleGallery onboardingId="onboarding_1" examples={[]} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
