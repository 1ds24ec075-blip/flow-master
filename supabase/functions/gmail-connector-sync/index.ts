// One-click Gmail PO sync via Lovable connector gateway
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

function gwHeaders() {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const gmailKey = Deno.env.get("GOOGLE_MAIL_API_KEY");
  if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");
  if (!gmailKey) throw new Error("GOOGLE_MAIL_API_KEY not configured — connect Gmail in Connectors");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": gmailKey,
    "Content-Type": "application/json",
  };
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string) {
  const h = headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

// Recursively walk MIME parts collecting PDF attachments
function collectPdfParts(payload: any, out: Array<{ filename: string; attachmentId: string; mimeType: string }> = []) {
  if (!payload) return out;
  const fn = payload.filename || "";
  const mime = payload.mimeType || "";
  const isPdf = mime === "application/pdf" || fn.toLowerCase().endsWith(".pdf");
  if (isPdf && payload.body?.attachmentId) {
    out.push({ filename: fn || "attachment.pdf", attachmentId: payload.body.attachmentId, mimeType: mime });
  }
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) collectPdfParts(p, out);
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json().catch(() => ({}));
    const query = body.query || 'subject:(PO OR "purchase order" OR "sales order") has:attachment newer_than:7d';
    const maxResults = Math.min(body.maxResults || 15, 50);

    const headers = gwHeaders();

    // 1. List matching messages
    const listUrl = `${GATEWAY}/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`;
    const listRes = await fetch(listUrl, { headers });
    if (!listRes.ok) {
      const t = await listRes.text();
      throw new Error(`Gmail list failed [${listRes.status}]: ${t}`);
    }
    const listData = await listRes.json();
    const messages = listData.messages || [];
    console.log(`Found ${messages.length} candidate emails`);

    let processed = 0;
    let posCreated = 0;
    const results: any[] = [];

    for (const m of messages) {
      try {
        // 2. Fetch full message
        const msgRes = await fetch(`${GATEWAY}/users/me/messages/${m.id}?format=full`, { headers });
        if (!msgRes.ok) {
          console.error(`Skip ${m.id}: ${msgRes.status}`);
          continue;
        }
        const msg = await msgRes.json();
        const subject = getHeader(msg.payload?.headers || [], "subject");
        const from = getHeader(msg.payload?.headers || [], "from");
        const dateHeader = getHeader(msg.payload?.headers || [], "date");
        const emailDate = dateHeader ? new Date(dateHeader).toISOString() : new Date(parseInt(msg.internalDate || "0")).toISOString();

        const pdfs = collectPdfParts(msg.payload);
        if (pdfs.length === 0) {
          console.log(`No PDFs in: ${subject}`);
          continue;
        }

        for (const pdf of pdfs) {
          // 3. Download attachment via gateway
          const attRes = await fetch(
            `${GATEWAY}/users/me/messages/${m.id}/attachments/${pdf.attachmentId}`,
            { headers }
          );
          if (!attRes.ok) {
            console.error(`Attachment fetch failed for ${pdf.filename}: ${attRes.status}`);
            continue;
          }
          const att = await attRes.json();
          // Gmail returns base64url — convert to standard base64 for process-po
          const fileData = (att.data || "").replace(/-/g, "+").replace(/_/g, "/");

          // 4. Forward to existing process-po pipeline
          const poRes = await fetch(`${supabaseUrl}/functions/v1/process-po`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileName: pdf.filename,
              fileData,
              emailSubject: subject,
              emailFrom: from,
              emailDate,
            }),
          });

          const poResult = await poRes.json().catch(() => ({}));
          if (poRes.ok) {
            posCreated++;
            results.push({ subject, file: pdf.filename, status: "ok", id: poResult.id });
          } else {
            results.push({ subject, file: pdf.filename, status: "failed", error: poResult.error || `HTTP ${poRes.status}` });
          }
        }
        processed++;
      } catch (e) {
        console.error(`Error on message ${m.id}:`, e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, scanned: messages.length, processed, posCreated, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("gmail-connector-sync error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
