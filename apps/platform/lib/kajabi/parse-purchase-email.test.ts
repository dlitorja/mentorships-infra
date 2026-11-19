import { describe, expect, it } from "vitest";
import { parseKajabiPurchaseEmail } from "./parse-purchase-email";

const forwardedSample = `---------- Forwarded message ---------
From: Kajabi Support <support@kajabi.com>
Date: Wed, Nov 18, 2026 at 10:44 AM
Subject: Congratulations! New purchase for 'Neil Gray - (1-on-1) Mentorship
'
To: <support@huckleberry.art>


You've got a new purchase for 'Neil Gray - (1-on-1) Mentorship '.
Congratulations on making a sale!

Details:
Name: Test Student
Email: student@example.com
Purchase ID: 2232228150 <(223) 222-8150>

You can view the customer details by clicking below:

View Customer <https://app.kajabi.com/admin/contacts/2766410261>

*This is an automated email from Kajabi. Responses to this email are not
monitored.*`;

const directSample = `You've got a new purchase for 'Neil Gray - Group Mentorship'.
Congratulations on making a sale!

Details:
Name: Another Student
Email: another@example.com
Purchase ID: 99887766

View Customer <https://app.kajabi.com/admin/contacts/123456>`;

describe("parseKajabiPurchaseEmail", () => {
  it("parses a forwarded 1-on-1 confirmation", () => {
    expect(
      parseKajabiPurchaseEmail({
        subject:
          "Fwd: Congratulations! New purchase for 'Neil Gray - (1-on-1) Mentorship '",
        text: forwardedSample,
      })
    ).toEqual({
      offerTitle: "Neil Gray - (1-on-1) Mentorship",
      purchaseType: "one-on-one",
      instructorName: "Neil Gray",
      studentName: "Test Student",
      studentEmail: "student@example.com",
      kajabiPurchaseId: "2232228150",
      kajabiContactId: "2766410261",
    });
  });

  it("parses a direct group confirmation", () => {
    expect(
      parseKajabiPurchaseEmail({
        subject:
          "Congratulations! New purchase for 'Neil Gray - Group Mentorship'",
        text: directSample,
      })
    ).toEqual({
      offerTitle: "Neil Gray - Group Mentorship",
      purchaseType: "group",
      instructorName: "Neil Gray",
      studentName: "Another Student",
      studentEmail: "another@example.com",
      kajabiPurchaseId: "99887766",
      kajabiContactId: "123456",
    });
  });

  it("returns null when the email is not a purchase confirmation", () => {
    expect(
      parseKajabiPurchaseEmail({
        subject: "Question about my invoice",
        text: "Hi, can you check my charge?",
      })
    ).toBeNull();
  });
});
