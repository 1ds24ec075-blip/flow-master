const Privacy = () => {
  return (
    <div className="container mx-auto max-w-3xl py-12 px-4 prose prose-slate dark:prose-invert">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: April 27, 2026</p>

      <h2>1. Overview</h2>
      <p>
        We provide an MSME workflow automation platform. This policy explains what
        data we collect, how we use it, and your rights.
      </p>

      <h2>2. Data we collect</h2>
      <ul>
        <li>Account info: name, email, organisation.</li>
        <li>Business documents you upload (POs, invoices, bank statements).</li>
        <li>Email metadata and attachments from connected Gmail inboxes (when you opt in).</li>
      </ul>

      <h2>3. Google user data (Gmail integration)</h2>
      <p>
        When you connect Gmail, we request Gmail access to scan unread messages for
        purchase orders, invoices and bills, then mark processed messages as read. We:
      </p>
      <ul>
        <li>Only process unread messages with relevant attachments.</li>
        <li>Store relevant attachments and extracted data in your account.</li>
        <li>Never sell, share, or use your Gmail data for advertising.</li>
        <li>Delete stored Gmail tokens and processed-email records on disconnect.</li>
      </ul>
      <p>
        Our use of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>, including the Limited Use requirements.
      </p>

      <h2>4. How we use your data</h2>
      <ul>
        <li>Run the workflows you configure (PO extraction, reconciliation, etc.).</li>
        <li>Show you dashboards and exports of your own data.</li>
        <li>Improve reliability and security of the service.</li>
      </ul>

      <h2>5. Data sharing</h2>
      <p>We do not sell your data. We share it only with subprocessors required to run the service (hosting, AI extraction).</p>

      <h2>6. Retention &amp; deletion</h2>
      <p>You can disconnect Gmail or delete your account at any time. On disconnect, OAuth tokens are revoked and processed-email records are deleted.</p>

      <h2>7. Contact</h2>
      <p>For privacy questions, contact your account administrator.</p>
    </div>
  );
};

export default Privacy;
