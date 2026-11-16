import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateInstructorPage from "./page";

vi.mock("@/lib/queries/api-client", () => ({
  createAdminInstructor: vi.fn(),
  uploadInstructorImage: vi.fn(),
  ApiFetchError: class ApiFetchError extends Error {
    data: { error: string } | Record<string, unknown>;
    constructor(message: string, data?: { error: string } | Record<string, unknown>) {
      super(message);
      this.name = "ApiFetchError";
      this.data = data ?? {};
    }
  },
}));

vi.mock("@/lib/validation/discord", () => ({
  isValidDiscordUrl: (url: string) => {
    if (!url) return true;
    return url.startsWith("https://discord.gg/") || url.startsWith("https://discord.com/channels/");
  },
}));

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

import { createAdminInstructor, uploadInstructorImage, ApiFetchError } from "@/lib/queries/api-client";

const mockCreateAdminInstructor = vi.mocked(createAdminInstructor);
const mockUploadInstructorImage = vi.mocked(uploadInstructorImage);

describe("CreateInstructorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminInstructor.mockResolvedValue({
      instructor: { id: "instructor_123", name: "Jane Doe" },
    });
    mockUploadInstructorImage.mockResolvedValue({ ok: true });
  });

  it("renders the create instructor form", () => {
    render(<CreateInstructorPage />);
    expect(screen.getByRole("heading", { name: /create instructor/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
  });

  it("generates slug from name", async () => {
    const user = userEvent.setup();
    render(<CreateInstructorPage />);

    const nameInput = screen.getByLabelText(/name/i);
    await user.type(nameInput, "Jane Doe");

    await waitFor(() => {
      expect(screen.getByDisplayValue("jane-doe")).toBeInTheDocument();
    });
  });

  it("shows validation error for invalid Discord URL", async () => {
    const user = userEvent.setup();
    render(<CreateInstructorPage />);

    const discordInput = screen.getByLabelText(/discord voice channel url/i);
    await user.type(discordInput, "http://invalid.com");
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/enter a valid HTTPS Discord link/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /create instructor/i })).toBeDisabled();
  });

  it("creates instructor without image", async () => {
    const user = userEvent.setup();
    render(<CreateInstructorPage />);

    await user.type(screen.getByLabelText(/name/i), "Jane Doe");
    await user.type(screen.getByLabelText(/email/i), "jane@example.com");
    await user.type(
      screen.getByLabelText(/discord voice channel url/i),
      "https://discord.gg/example"
    );
    await user.type(screen.getByLabelText(/tagline/i), "Expert mentor");
    await user.type(screen.getByLabelText(/bio/i), "Jane has 10 years of experience.");

    await user.click(screen.getByRole("button", { name: /create instructor/i }));

    await waitFor(() => {
      expect(mockCreateAdminInstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Jane Doe",
          slug: "jane-doe",
          email: "jane@example.com",
          discordVoiceChannelUrl: "https://discord.gg/example",
          tagline: "Expert mentor",
          bio: "Jane has 10 years of experience.",
        })
      );
      expect(mockUploadInstructorImage).not.toHaveBeenCalled();
      // Create now lands on the new instructor's edit page carrying the
      // invitation/image outcomes, instead of silently returning to the list.
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      const destination = mockRouter.push.mock.calls[0][0] as string;
      expect(destination).toMatch(/^\/admin\/instructors\/instructor_123\/edit\?/);
      expect(destination).toContain("created=1");
      expect(destination).toContain("invitation=not-requested");
      expect(destination).toContain("email=jane%40example.com");
    });
  });

  it("carries a failed invitation to the edit page instead of discarding it", async () => {
    const user = userEvent.setup();
    mockCreateAdminInstructor.mockResolvedValue({
      instructor: { id: "instructor_123", name: "Jane Doe" },
      invitationSent: false,
      invitationError: "Clerk invite failed",
    });

    render(<CreateInstructorPage />);

    await user.type(screen.getByLabelText(/name/i), "Jane Doe");
    await user.type(screen.getByLabelText(/email/i), "jane@example.com");
    await user.type(
      screen.getByLabelText(/discord voice channel url/i),
      "https://discord.gg/example"
    );

    await user.click(screen.getByRole("button", { name: /create instructor/i }));

    await waitFor(() => {
      const destination = mockRouter.push.mock.calls[0][0] as string;
      const params = new URLSearchParams(destination.split("?")[1]);
      expect(params.get("invitation")).toBe("failed");
      expect(params.get("invitationError")).toBe("Clerk invite failed");
    });
  });

  it("creates instructor and uploads profile image", async () => {
    const user = userEvent.setup();
    const { container } = render(<CreateInstructorPage />);

    await user.type(screen.getByLabelText(/name/i), "John Smith");
    await user.type(
      screen.getByLabelText(/discord voice channel url/i),
      "https://discord.gg/example"
    );

    const file = new File(["image"], "profile.png", { type: "image/png" });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(/selected: profile.png/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /create instructor/i }));

    await waitFor(() => {
      expect(mockUploadInstructorImage).toHaveBeenCalled();
    });
    const formData = mockUploadInstructorImage.mock.calls[0][0];
    expect(formData.get("file")).toBe(file);
    expect(formData.get("instructorId")).toBe("instructor_123");
    expect(formData.get("type")).toBe("profile");
  });

  it("carries a failed image upload to the edit page instead of swallowing it", async () => {
    const user = userEvent.setup();
    mockUploadInstructorImage.mockRejectedValue(new Error("B2 unavailable"));
    const { container } = render(<CreateInstructorPage />);

    await user.type(screen.getByLabelText(/name/i), "John Smith");
    await user.type(
      screen.getByLabelText(/discord voice channel url/i),
      "https://discord.gg/example"
    );

    const file = new File(["image"], "profile.png", { type: "image/png" });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(/selected: profile.png/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /create instructor/i }));

    await waitFor(() => {
      // The instructor was still created — the upload failure is reported, not fatal.
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      const destination = mockRouter.push.mock.calls[0][0] as string;
      const params = new URLSearchParams(destination.split("?")[1]);
      expect(params.get("imageError")).toBe("B2 unavailable");
    });
  });

  it("displays API error message when creation fails", async () => {
    const user = userEvent.setup();
    mockCreateAdminInstructor.mockRejectedValue(
      new ApiFetchError("Slug already taken", { error: "Slug already taken" })
    );

    render(<CreateInstructorPage />);

    await user.type(screen.getByLabelText(/name/i), "Jane Doe");
    await user.type(
      screen.getByLabelText(/discord voice channel url/i),
      "https://discord.gg/example"
    );

    await user.click(screen.getByRole("button", { name: /create instructor/i }));

    await waitFor(() => {
      expect(screen.getByText(/slug already taken/i)).toBeInTheDocument();
    });
  });
});
