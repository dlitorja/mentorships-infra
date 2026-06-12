import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal/legal-layout";

export const metadata: Metadata = {
  title: "Terms of Service | Huckleberry Art Inc.",
  description: "Huckleberry Art Inc. Terms of Service - The terms and conditions governing your use of our services.",
};

export default function TermsOfServicePage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="June 12, 2026">
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">1. Acceptance of Terms</h2>
        <p className="text-muted-foreground leading-relaxed">
          Welcome to Huckleberry Art Inc. By accessing or using our platform, website, and services (collectively, the "Services"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not access or use our Services. These Terms constitute a legally binding agreement between you and Huckleberry Art Inc. Please read them carefully before using our Services.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">2. Description of Services</h2>
        <p className="text-muted-foreground leading-relaxed">
          Huckleberry Art Inc. provides an online platform connecting students with art instructors for personalized mentorship experiences. Our Services include access to instructor profiles, course offerings, booking and payment processing, and related educational content. We reserve the right to modify, suspend, or discontinue any aspect of our Services at any time without prior notice.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">3. User Accounts</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          To access certain features of our Services, you may be required to create an account. You agree to provide accurate, current, and complete information during the registration process and to update such information to keep it accurate. You are solely responsible for:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Maintaining the confidentiality of your account credentials</li>
          <li>All activities that occur under your account</li>
          <li>Immediately notifying us of any unauthorized use of your account</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">
          We reserve the right to suspend or terminate accounts that violate these Terms or that we deem necessary to protect our platform or other users.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">4. User Obligations</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          When using our Services, you agree not to:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Violate any applicable laws, regulations, or third-party rights</li>
          <li>Use our Services for any fraudulent, deceptive, or harmful purpose</li>
          <li>Upload or transmit viruses, malware, or other malicious code</li>
          <li>Attempt to gain unauthorized access to our systems or other user accounts</li>
          <li>Interfere with the proper functioning of our platform</li>
          <li>Collect or harvest user information without consent</li>
          <li>Impersonate any person or entity</li>
          <li>Upload obscene, offensive, or inappropriate content</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">5. Payments and Refunds</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          By making a purchase through our platform, you agree to pay all applicable fees as described at the time of purchase. All payments are processed securely through our designated payment processors. The following payment terms apply:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>All fees are non-refundable unless specifically stated otherwise or required by law</li>
          <li>Refunds may be granted at our sole discretion in exceptional circumstances</li>
          <li>You authorize us to charge your selected payment method for all applicable fees</li>
          <li>We reserve the right to change our pricing at any time with reasonable notice</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">6. Mentorship Sessions</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Our platform facilitates mentorship sessions between instructors and students. By booking a session, you agree to:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Attend scheduled sessions punctually</li>
          <li>Provide reasonable advance notice if you need to reschedule (at least 24 hours)</li>
          <li>Respect instructors' time and professional boundaries</li>
          <li>Not record sessions without explicit consent from all participants</li>
          <li>Use session content solely for personal educational purposes</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">
          Instructors reserve the right to decline future sessions with students who repeatedly miss appointments or behave inappropriately.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">7. Intellectual Property</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          All content, materials, and intellectual property available through our Services, including but not limited to text, graphics, logos, images, videos, courses, and software, are owned by Huckleberry Art Inc. or our instructors and are protected by applicable intellectual property laws. You agree not to:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Copy, reproduce, distribute, or create derivative works from our content without permission</li>
          <li>Redistribute, sell, or exploit course materials accessed through our platform</li>
          <li>Use our trademarks, logos, or branding without our written consent</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">
          Instructors retain ownership of their own content and materials. Students receive a limited license to access course content for personal educational use only.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">8. Limitation of Liability</h2>
        <p className="text-muted-foreground leading-relaxed">
          To the maximum extent permitted by law, Huckleberry Art Inc. shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, use, goodwill, or other intangible losses, resulting from: (i) your access to or use of (or inability to access or use) our Services; (ii) any conduct or content of any third party on our Services; (iii) any content obtained from our Services; and (iv) unauthorized access, use, or alteration of your transmissions or content. In no event shall our total liability exceed the amount you paid us in the twelve (12) months preceding the claim.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">9. Disclaimer of Warranties</h2>
        <p className="text-muted-foreground leading-relaxed">
          OUR SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. We do not warrant that our Services will be uninterrupted, secure, or error-free, or that any defects will be corrected.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">10. Indemnification</h2>
        <p className="text-muted-foreground leading-relaxed">
          You agree to defend, indemnify, and hold harmless Huckleberry Art Inc., its officers, directors, employees, contractors, agents, and representatives from and against any and all claims, damages, obligations, losses, liabilities, costs, or debt, and expenses (including attorney's fees) arising from: (i) your use of our Services; (ii) your violation of these Terms; or (iii) your violation of any third-party right, including any intellectual property or privacy rights.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">11. Account Termination</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We may terminate or suspend your account and access to our Services immediately, without prior notice or liability, at our sole discretion, for any reason, including but not limited to:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Breach of these Terms</li>
          <li>Fraudulent, deceptive, or illegal activity</li>
          <li>Non-payment of fees or charges</li>
          <li>Repeated complaints from instructors or other users</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">
          Upon termination, your right to use our Services will immediately cease. Provisions of these Terms that by their nature should survive termination shall survive, including ownership provisions, warranty disclaimers, indemnification, and limitations of liability.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">12. Governing Law</h2>
        <p className="text-muted-foreground leading-relaxed">
          These Terms shall be governed by and construed in accordance with the laws of the United States and the state in which Huckleberry Art Inc. is headquartered, without regard to conflicts of law principles. You agree to submit to the personal and exclusive jurisdiction of the state and federal courts located within that state.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">13. Changes to Terms</h2>
        <p className="text-muted-foreground leading-relaxed">
          We reserve the right to modify or replace these Terms at any time at our sole discretion. If a revision is material, we will provide at least thirty (30) days' notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion. By continuing to access or use our Services after any revisions become effective, you agree to be bound by the revised terms.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">14. Contact Information</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          If you have any questions about these Terms, please contact us:
        </p>
        <div className="mt-4 text-muted-foreground">
          <p><strong className="text-white">Huckleberry Art Inc.</strong></p>
          <p>Email: legal@huckleberry.art</p>
        </div>
      </section>
    </LegalLayout>
  );
}