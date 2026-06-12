import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal/legal-layout";

export const metadata: Metadata = {
  title: "Privacy Policy | Huckleberry Art Inc.",
  description: "Huckleberry Art Inc. Privacy Policy - Learn how we collect, use, and protect your personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="June 12, 2026">
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">1. Introduction</h2>
        <p className="text-muted-foreground leading-relaxed">
          Huckleberry Art Inc. ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website, use our services, or interact with our platform. Please read this policy carefully. By using our services, you agree to the collection and use of information in accordance with this policy.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">2. Information We Collect</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We collect several types of information from and about users of our services, including:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li><strong className="text-white">Personal Data:</strong> Name, email address, postal address, phone number, and other contact information you provide when creating an account, making a purchase, or subscribing to our communications.</li>
          <li><strong className="text-white">Payment Information:</strong> Credit card numbers, billing addresses, and other payment details collected through our secure payment processors.</li>
          <li><strong className="text-white">Usage Data:</strong> Information about how you access and use our platform, including your IP address, browser type, pages viewed, time spent on pages, and other diagnostic data.</li>
          <li><strong className="text-white">Communication Data:</strong> Records of correspondence when you contact us directly, including support requests and feedback.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">3. How We Use Your Information</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We use the information we collect for the following purposes:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>To provide, maintain, and improve our services</li>
          <li>To process transactions and send related information</li>
          <li>To send you technical notices, updates, and support messages</li>
          <li>To respond to your comments, questions, and customer service requests</li>
          <li>To communicate with you about products, services, and events</li>
          <li>To monitor usage patterns and analyze platform performance</li>
          <li>To detect, prevent, and address technical issues and fraud</li>
          <li>To comply with legal obligations</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">4. Cookies and Tracking Technologies</h2>
        <p className="text-muted-foreground leading-relaxed">
          We use cookies and similar tracking technologies to track activity on our platform and hold certain information. Cookies are files with a small amount of data that may include an anonymous unique identifier. You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent. However, if you do not accept cookies, some portions of our services may not function properly.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">5. Data Sharing and Disclosure</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We do not sell your personal information. We may share your information in the following circumstances:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li><strong className="text-white">Service Providers:</strong> We may share information with third-party vendors, contractors, and agents who perform services on our behalf, such as payment processing, data analysis, and email delivery.</li>
          <li><strong className="text-white">Business Transfers:</strong> If Huckleberry Art Inc. is involved in a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction.</li>
          <li><strong className="text-white">Legal Requirements:</strong> We may disclose information if required to do so by law or in response to valid requests by public authorities.</li>
          <li><strong className="text-white">With Your Consent:</strong> We may share information with third parties when you explicitly consent to such sharing.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">6. Data Security</h2>
        <p className="text-muted-foreground leading-relaxed">
          We implement appropriate technical and organizational security measures designed to protect the security of any personal information we collect. However, no method of transmission over the Internet or electronic storage is 100% secure, and we cannot guarantee absolute security. If you have concerns about the security of your data, please contact us immediately.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">7. Your Rights</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Depending on your location, you may have certain rights regarding your personal information, including:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>The right to access the personal information we hold about you</li>
          <li>The right to request correction of inaccurate information</li>
          <li>The right to request deletion of your personal information</li>
          <li>The right to object to or restrict certain processing activities</li>
          <li>The right to data portability</li>
          <li>The right to withdraw consent at any time</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">
          To exercise any of these rights, please contact us using the information provided below. We will respond to your request within the timeframe required by applicable law.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">8. Third-Party Links</h2>
        <p className="text-muted-foreground leading-relaxed">
          Our platform may contain links to third-party websites and services that are not operated by us. We have no control over and assume no responsibility for the privacy practices of any such third-party sites or services. We encourage you to review the privacy policies of those third parties before providing any personal information.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">9. Children's Privacy</h2>
        <p className="text-muted-foreground leading-relaxed">
          Our services are not intended for individuals under the age of 18. We do not knowingly collect personal information from children under 18. If we learn that we have collected personal information from a child under 18, we will take steps to delete that information as soon as possible. If you believe we have collected information from a minor, please contact us immediately.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">10. Changes to This Privacy Policy</h2>
        <p className="text-muted-foreground leading-relaxed">
          We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date. You are advised to review this Privacy Policy periodically for any changes. Your continued use of our services after any modifications constitutes acceptance of the updated policy.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">11. Contact Us</h2>
        <p className="text-muted-foreground leading-relaxed">
          If you have any questions or concerns about this Privacy Policy, please contact us:
        </p>
        <div className="mt-4 text-muted-foreground">
          <p><strong className="text-white">Huckleberry Art Inc.</strong></p>
          <p>Email: privacy@huckleberry.art</p>
        </div>
      </section>
    </LegalLayout>
  );
}