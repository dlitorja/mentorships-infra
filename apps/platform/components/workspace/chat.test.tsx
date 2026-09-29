import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkspaceChat from "./chat";
import { renderWithProviders } from "tests/unit/test-utils";

const mockCreateMessage = vi.fn();
const mockCreateImageAndMessage = vi.fn();
const mockCreateFileMessage = vi.fn();
const mockUseWorkspaceMessagesPaginated = vi.fn();
const mockUseWorkspace = vi.fn();
const mockUseWorkspaceFileCounts = vi.fn();
const mockUseConvexAction = vi.fn();
const mockUseChatData = vi.fn();

vi.mock("@/components/workspace/chat-data-context", () => ({
  useChatData: () => mockUseChatData(),
}));

vi.mock("@/lib/queries/convex/use-workspaces", () => ({
  useWorkspaceMessagesPaginated: (workspaceId: string | null) =>
    mockUseWorkspaceMessagesPaginated(workspaceId),
  useWorkspace: (workspaceId: string) => mockUseWorkspace(workspaceId),
  useWorkspaceFileCounts: (workspaceId: string) => mockUseWorkspaceFileCounts(workspaceId),
  useCreateWorkspaceMessage: () => ({
    mutateAsync: mockCreateMessage,
    isPending: false,
  }),
  useCreateWorkspaceImageAndMessage: () => ({
    mutateAsync: mockCreateImageAndMessage,
    isPending: false,
  }),
  useCreateWorkspaceFileMessage: () => ({
    mutateAsync: mockCreateFileMessage,
    isPending: false,
  }),
  useGenerateWorkspaceUploadUrl: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      uploadUrl: "https://b2.example/upload",
      b2Key: "ws/ws_1/key_1",
      expiresAt: Date.now() + 3_600_000,
    }),
    isPending: false,
  }),
  useRecordB2FileUpload: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useCreateWorkspaceLink: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@convex-dev/react-query", () => ({
  useConvexAction: () => mockUseConvexAction(),
  convexQuery: () => ({ queryKey: ["mock"] }),
}));

vi.mock("@/lib/b2-workspace-upload", () => ({
  validateB2Files: vi.fn((_workspaceId, _files) => ({ validFiles: [], invalidFiles: [] })),
  createB2ImagePreviews: vi.fn(() => Promise.resolve([])),
  uploadFileToB2: vi.fn(() => Promise.resolve({ success: true, b2Key: "ws/ws_1/key_1" })),
}));

const mockMessages = [
  {
    _id: "msg_1",
    workspaceId: "ws_1",
    userId: "user_2",
    authorDisplayName: "Alex Instructor",
    content: "Hello from instructor",
    type: "text",
  },
  {
    _id: "msg_2",
    workspaceId: "ws_1",
    userId: "user_1",
    authorDisplayName: "Student User",
    content: "Hello from student",
    type: "text",
  },
];

describe("WorkspaceChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseChatData.mockReturnValue(null);
    mockUseWorkspaceMessagesPaginated.mockReturnValue({
      results: mockMessages,
      isLoading: false,
      loadMore: vi.fn(),
      status: "Exhausted",
    });
    mockUseWorkspace.mockReturnValue({
      data: {
        _id: "ws_1",
        studentImageCount: 0,
        instructorImageCount: 0,
      },
      isLoading: false,
    });
    mockUseWorkspaceFileCounts.mockReturnValue({
      data: { student: 0, instructor: 0 },
      isLoading: false,
    });
    mockUseConvexAction.mockReturnValue(vi.fn());
  });

  it("renders loading state", () => {
    mockUseWorkspaceMessagesPaginated.mockReturnValue({
      results: undefined,
      isLoading: true,
      loadMore: vi.fn(),
      status: "Loading",
    });
    const { container } = renderWithProviders(
      <WorkspaceChat workspaceId="ws_1" currentUserId="user_1" role="student" activeSessionId={null} />
    );
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByText(/no messages yet/i)).not.toBeInTheDocument();
  });

  it("renders empty state", () => {
    mockUseWorkspaceMessagesPaginated.mockReturnValue({
      results: [],
      isLoading: false,
      loadMore: vi.fn(),
      status: "Exhausted",
    });
    renderWithProviders(
      <WorkspaceChat workspaceId="ws_1" currentUserId="user_1" role="student" activeSessionId={null} />
    );
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
    expect(screen.getByText(/start the conversation/i)).toBeInTheDocument();
  });

  it("renders messages in order with correct alignment", () => {
    renderWithProviders(
      <WorkspaceChat workspaceId="ws_1" currentUserId="user_1" role="student" activeSessionId={null} />
    );
    expect(screen.getByText("Hello from instructor")).toBeInTheDocument();
    expect(screen.getByText("Hello from student")).toBeInTheDocument();
    expect(screen.getByText("Alex Instructor")).toBeInTheDocument();
    expect(screen.queryByText("user_2")).not.toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("sends a text message when Enter is pressed", async () => {
    const user = userEvent.setup();
    mockCreateMessage.mockResolvedValue({});
    renderWithProviders(
      <WorkspaceChat workspaceId="ws_1" currentUserId="user_1" role="student" activeSessionId={null} />
    );

    const input = screen.getByPlaceholderText(/type a message/i);
    await user.type(input, "New message");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockCreateMessage).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        content: "New message",
        type: "text",
        sessionId: undefined,
      });
    });
  });

  it("sends a text message when send button is clicked", async () => {
    const user = userEvent.setup();
    mockCreateMessage.mockResolvedValue({});
    renderWithProviders(
      <WorkspaceChat workspaceId="ws_1" currentUserId="user_1" role="student" activeSessionId={null} />
    );

    const input = screen.getByPlaceholderText(/type a message/i);
    await user.type(input, "Button message");
    await user.click(screen.getByLabelText(/send message/i));

    await waitFor(() => {
      expect(mockCreateMessage).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        content: "Button message",
        type: "text",
        sessionId: undefined,
      });
    });
  });

  it("does not send empty messages", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <WorkspaceChat workspaceId="ws_1" currentUserId="user_1" role="student" activeSessionId={null} />
    );

    const sendButton = screen.getByLabelText(/send message/i);
    expect(sendButton).toBeDisabled();

    const input = screen.getByPlaceholderText(/type a message/i);
    await user.type(input, "   ");
    expect(sendButton).toBeDisabled();

    await user.keyboard("{Enter}");
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("tags message to active session when provided", async () => {
    const user = userEvent.setup();
    mockCreateMessage.mockResolvedValue({});
    renderWithProviders(
      <WorkspaceChat
        workspaceId="ws_1"
        currentUserId="user_1"
        role="student"
        activeSessionId="session_1"
      />
    );

    const input = screen.getByPlaceholderText(/type a message/i);
    await user.type(input, "Session tagged");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockCreateMessage).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        content: "Session tagged",
        type: "text",
        sessionId: "session_1",
      });
    });
  });

  // PR platform-call-bugs: system messages are NOT user-authored —
  // they describe a participant-joined / -left event from the
  // Daily.co call and render as a muted, centered notice without
  // an avatar / bubble / ShareLink affordance. This test pins the
  // rendering branch so any regression to the user-authored
  // message bubble surfaces as a CI failure.
  it("renders system messages distinctly (centered, muted, no bubble)", () => {
    mockUseWorkspaceMessagesPaginated.mockReturnValue({
      results: [
        {
          _id: "msg_sys_1",
          workspaceId: "ws_1",
          userId: "user_2",
          authorDisplayName: "Alex Instructor",
          content: "Alex joined the call",
          type: "system",
          systemEventKind: "joined",
          sessionId: "session_1",
        },
      ],
      isLoading: false,
      loadMore: vi.fn(),
      status: "Exhausted",
    });
    renderWithProviders(
      <WorkspaceChat workspaceId="ws_1" currentUserId="user_1" role="student" activeSessionId={null} />
    );
    // System row is rendered through the dedicated branch — verify
    // the marker testid is present.
    const systemRow = screen.getByTestId("chat-system-message");
    expect(systemRow).toBeInTheDocument();
    expect(systemRow.getAttribute("data-system-event-kind")).toBe("joined");
    expect(systemRow.textContent).toContain("Alex joined the call");
    // The user-authored bubble would surface "Alex Instructor" as
    // an avatar name; the system branch must NOT, since system rows
    // are not attributed to any user.
    expect(screen.queryByText("Alex Instructor")).not.toBeInTheDocument();
    // Sanity: the system row is centered (flex justify-center).
    expect(systemRow.className).toContain("justify-center");
  });
});
