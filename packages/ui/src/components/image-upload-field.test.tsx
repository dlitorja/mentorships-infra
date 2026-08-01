import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageUploadField } from "./image-upload-field";

vi.mock("next/image", () => ({
  __esModule: true,
  default: function MockImage(props: any) {
    const sanitized: any = {};
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value === true) {
        sanitized[key] = "";
      } else if (value !== false) {
        sanitized[key] = value;
      }
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...sanitized} alt={props.alt || ""} src={props.src} />;
  },
}));

const mockFetch = vi.fn();

function getFileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

// Store the original fetch so we can restore it between tests
const originalFetch = global.fetch;

describe("ImageUploadField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders URL input and drop zone", () => {
    render(<ImageUploadField onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/drag & drop or/i)).toBeInTheDocument();
  });

  it("calls onChange when URL is typed and committed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ImageUploadField onChange={onChange} />);

    const input = screen.getByPlaceholderText(/example.com/i);
    await user.type(input, "https://example.com/image.png");
    await user.tab();

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("https://example.com/image.png");
    });
  });

  it("calls onCommit when URL is committed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<ImageUploadField onChange={onChange} onCommit={onCommit} />);

    const input = screen.getByPlaceholderText(/example.com/i);
    await user.type(input, "https://example.com/image.png");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("https://example.com/image.png");
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears URL input when clear button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ImageUploadField value="https://example.com/image.png" onChange={onChange} />);

    const clearButton = screen.getByRole("button", { name: /clear image/i });
    await user.click(clearButton);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("");
    });
  });

  it("uploads a file and calls onChange and onUploadComplete", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onUploadComplete = vi.fn();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://cdn.example.com/uploaded.png", path: "uploads/image.png" }),
    });

    const { container } = render(
      <ImageUploadField
        uploadEndpoint="/api/admin/upload"
        onChange={onChange}
        onUploadComplete={onUploadComplete}
      />
    );

    const file = new File(["image"], "test.png", { type: "image/png" });
    const input = getFileInput(container);
    expect(input).toBeInTheDocument();
    await user.upload(input, file);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/upload",
        expect.objectContaining({ method: "POST" })
      );
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("https://cdn.example.com/uploaded.png");
      expect(onUploadComplete).toHaveBeenCalledWith(
        "https://cdn.example.com/uploaded.png",
        "uploads/image.png"
      );
    });
  });

  it("shows upload error when server returns error", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Upload failed" }),
    });

    const { container } = render(<ImageUploadField uploadEndpoint="/api/admin/upload" onChange={vi.fn()} />);

    const file = new File(["image"], "test.png", { type: "image/png" });
    const input = getFileInput(container);
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(/upload failed/i)).toBeInTheDocument();
    });
  });

  it("uploads via instructor endpoint when instructorId is provided", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://cdn.example.com/instructor.png" }),
    });

    const { container } = render(
      <ImageUploadField
        instructorId="instructor_1"
        type="profile"
        onChange={onChange}
      />
    );

    const file = new File(["image"], "test.png", { type: "image/png" });
    const input = getFileInput(container);
    await user.upload(input, file);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/instructors/upload",
        expect.objectContaining({ method: "POST" })
      );
    });
  });
});
