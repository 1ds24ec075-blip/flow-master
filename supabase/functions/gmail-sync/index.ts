import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { google } from "https://esm.sh/googleapis@128";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface GmailMessage {
  id: string;
  threadId: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    parts?: Array<{
      mimeType: string;
      filename: string;
      body: { attachmentId?: string; data?: string; size: number };
      parts?: any[];
    }>;
    body?: { data?: string };
  };
  internalDate: string;
}

type GmailPart = NonNullable<GmailMessage['payload']['parts']>[number];

function getHeader(message: GmailMessage, headerName: string): string {
  const header = message.payload.headers.find(
    (h) => h.name.toLowerCase() === headerName.toLowerCase()
  );
  return header ? header.value : '';
}

function hasInvoiceKeyword(subject: string, filters: string[]): boolean {
  const lowerSubject = subject.toLowerCase();
  return filters.some((filter) => lowerSubject.includes(filter.toLowerCase()));
}

async function downloadAttachment(
  gmail: any,
  messageId: string,
  attachmentId: string
): Promise<Uint8Array> {
  const attachment = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });

  const data = attachment.data.data;
  const binaryString = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isSupportedAttachment(part: GmailPart): boolean {
  const fileName = (part.filename || '').toLowerCase();
  return (
    isImageMimeType(part.mimeType || '') ||
    part.mimeType === 'application/pdf' ||
    /\.(jpe?g|png|webp|pdf)$/i.test(fileName)
  );
}

function collectAttachmentParts(parts: GmailPart[] = []): GmailPart[] {
  const attachments: GmailPart[] = [];
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId && isSupportedAttachment(part)) {
      attachments.push(part);
    }
    if (part.parts?.length) {
      attachments.push(...collectAttachmentParts(part.parts));
    }
  }
  return attachments;
}

async function refreshAccessTokenIfNeeded(
  supabase: any,
  integration: any,
): Promise<string> {
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  // Refresh if token expires within next 60 seconds
  if (expiresAt - 60_000 > Date.now()) {
    return integration.access_token;
  }
  if (!integration.refresh_token) {
    throw new Error('Token expired and no refresh token available. Reconnect Gmail.');
  }

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Google OAuth not configured');

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: integration.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Refresh failed: ${t}`);
  }
  const tokens = await resp.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from('gmail_integrations')
    .update({
      access_token: tokens.access_token,
      token_expires_at: newExpiresAt,
    })
    .eq('id', integration.id);

  integration.access_token = tokens.access_token;
  integration.token_expires_at = newExpiresAt;
  return tokens.access_token;
}

async function processAttachments(
  gmail: any,
  message: GmailMessage,
  supabase: any,
  _processedEmailId: string
): Promise<number> {
  let billsCreated = 0;
  const attachmentParts = collectAttachmentParts(message.payload.parts || []);

  for (const part of attachmentParts) {
      try {
        const attachmentData = await downloadAttachment(
          gmail,
          message.id,
          part.body.attachmentId!
        );

        const fileName = `gmail-${Date.now()}-${part.filename}`;
        const contentType = part.mimeType || (part.filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
        const { error: uploadError } = await supabase.storage
          .from('bills')
          .upload(fileName, attachmentData, { contentType });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          continue;
        }

        const { data: bill, error: insertError } = await supabase
          .from('bills')
          .insert({
            image_url: fileName,
            vendor_name: 'Processing from Gmail...',
            payment_status: 'pending',
          })
          .select()
          .single();

        if (insertError) {
          console.error('Bill insert error:', insertError);
          continue;
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        const extractResponse = await fetch(
          `${supabaseUrl}/functions/v1/bill-extract`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ billId: bill.id }),
          }
        );

        if (extractResponse.ok) {
          billsCreated++;
        } else {
          console.error('Extraction failed:', await extractResponse.text());
        }
      } catch (error) {
        console.error('Error processing attachment:', error);
      }
  }

  return billsCreated;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  let requestBody: { integrationId?: string } = {};

  try {
    requestBody = await req.json();
    const { integrationId } = requestBody;

    if (!integrationId) throw new Error('integrationId is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceKey || !anonKey) {
      throw new Error('Supabase credentials are missing');
    }

    // Authenticate caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) throw new Error('Not authenticated');
    const userId = userData.user.id;

    // Use service role for DB writes, but enforce ownership in the query
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: integration, error: integrationError } = await supabase
      .from('gmail_integrations')
      .select('*')
      .eq('id', integrationId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (integrationError || !integration) {
      throw new Error('Integration not found or not owned by user');
    }
    if (!integration.access_token) {
      throw new Error('No access token available');
    }

    // Refresh access token if needed
    const accessToken = await refreshAccessTokenIfNeeded(supabase, integration);

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: integration.refresh_token,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `is:unread has:attachment newer_than:30d`,
      maxResults: 20,
    });

    const messages = response.data.messages || [];
    let totalBillsCreated = 0;
    let totalProcessed = 0;

    for (const msg of messages) {
      try {
        const { data: existing } = await supabase
          .from('processed_emails')
          .select('id, status, bills_created')
          .eq('integration_id', integrationId)
          .eq('email_id', msg.id)
          .maybeSingle();

        if (existing?.status === 'success' && (existing.bills_created || 0) > 0) continue;

        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
        });

        const message = fullMessage.data as GmailMessage;
        const subject = getHeader(message, 'subject');
        const sender = getHeader(message, 'from');

        const subjectMatched = hasInvoiceKeyword(subject, integration.subject_filters || []);
        const attachmentCount = collectAttachmentParts(message.payload.parts || []).length;
        if (!subjectMatched && attachmentCount === 0) continue;

        const processedPayload = {
            user_id: userId,
            integration_id: integrationId,
            email_id: msg.id,
            thread_id: msg.threadId,
            subject,
            sender,
            received_at: new Date(parseInt(message.internalDate)).toISOString(),
            status: 'pending',
            attachments_count: attachmentCount,
        };

        const { data: processedEmail, error: processedError } = existing
          ? await supabase
              .from('processed_emails')
              .update(processedPayload)
              .eq('id', existing.id)
              .select()
              .single()
          : await supabase
          .from('processed_emails')
          .insert(processedPayload)
          .select()
          .single();

        if (processedError) {
          console.error('Error creating processed email record:', processedError);
          continue;
        }

        const billsCreated = await processAttachments(
          gmail,
          message,
          supabase,
          processedEmail.id
        );

        await supabase
          .from('processed_emails')
          .update({
            status: billsCreated > 0 ? 'success' : 'failed',
            bills_created: billsCreated,
            processed_at: new Date().toISOString(),
            error_message: billsCreated === 0 ? 'No valid image attachments found' : '',
          })
          .eq('id', processedEmail.id);

        // Mark email as read in Gmail so it isn't scanned again
        // Use direct fetch (bypasses googleapis auto-refresh which lacks client creds)
        try {
          const markResp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
            }
          );
          if (!markResp.ok) {
            console.error('Failed to mark message as read:', markResp.status, await markResp.text());
          }
        } catch (markErr) {
          console.error('Failed to mark message as read:', markErr);
        }

        totalBillsCreated += billsCreated;
        totalProcessed++;
      } catch (error) {
        console.error('Error processing message:', error);
      }
    }

    await supabase
      .from('gmail_integrations')
      .update({
        last_sync_at: new Date().toISOString(),
        sync_status: 'active',
        error_message: '',
      })
      .eq('id', integrationId);

    return new Response(
      JSON.stringify({
        success: true,
        processed: totalProcessed,
        billsCreated: totalBillsCreated,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in gmail-sync:', error);
    if (requestBody?.integrationId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && serviceKey) {
        const supabase = createClient(supabaseUrl, serviceKey);
        await supabase
          .from('gmail_integrations')
          .update({
            sync_status: 'error',
            error_message: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', requestBody.integrationId);
      }
    }
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
