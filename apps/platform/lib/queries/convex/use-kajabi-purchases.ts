import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type KajabiPurchaseStatus = "pending" | "approved" | "dismissed";

export type KajabiPurchaseListItem = {
  _id: Id<"kajabiPurchaseInbox">;
  subject: string;
  receivedAt: number;
  offerTitle: string;
  purchaseType: "one-on-one" | "group" | "unknown";
  instructorName?: string;
  studentName?: string;
  studentEmail?: string;
  kajabiPurchaseId?: string;
  status: KajabiPurchaseStatus;
  onboardingId?: Id<"adminOnboardings">;
  createdAt: number;
};

export type KajabiPurchase = KajabiPurchaseListItem & {
  resendEmailId: string;
  fromAddress: string;
  kajabiContactId?: string;
  rawText: string;
  approvedByUserId?: string;
  approvedAt?: number;
  dismissedByUserId?: string;
  dismissedAt?: number;
  dismissReason?: string;
  updatedAt: number;
};

export type InstructorOption = {
  id: Id<"instructors">;
  name?: string;
  email?: string;
  oneOnOneInventory?: number;
  groupInventory?: number;
  maxActiveStudents?: number;
  activeStudentCount: number;
};

export type KajabiPurchasePage = {
  items: KajabiPurchaseListItem[];
  nextCursor?: number;
};

export function useKajabiPurchases(
  status: KajabiPurchaseStatus,
  before?: number
): UseQueryResult<KajabiPurchasePage, Error> {
  return useQuery(
    convexQuery(api.kajabiPurchaseInbox.listPurchases, {
      status,
      ...(before ? { before } : {}),
    })
  );
}

export function useKajabiPurchase(
  id: Id<"kajabiPurchaseInbox"> | null
): UseQueryResult<KajabiPurchase | null, Error> {
  return useQuery({
    ...convexQuery(
      api.kajabiPurchaseInbox.getPurchase,
      id ? { id } : { id: "" as Id<"kajabiPurchaseInbox"> }
    ),
    enabled: !!id,
  });
}

export function useInstructorOptions(): UseQueryResult<InstructorOption[], Error> {
  return useQuery(
    convexQuery(api.adminOnboarding.getInstructorOptionsForOnboarding, {})
  );
}
