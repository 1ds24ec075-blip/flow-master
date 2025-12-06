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

async function processAttachments(
  gmail: any,
  message: GmailMessage,
  supabase: any,
  processedEmailId: string
): Promise<number> {
  let billsCreated = 0;
  const parts = message.payload.parts || [];

  for (const part of parts) {
    if (part.filename && part.body.attachmentId && isImageMimeType(part.mimeType)) {
      try {
        console.log('Processing attachment:', part.filename);

        const attachmentData = await downloadAttachment(
          gmail,
          message.id,
          part.body.attachmentId
        );

        const fileName = `gmail-${Date.now()}-${part.filename}`;
        const { error: uploadError } = await supabase.storage
          .from('bills')
          .upload(fileName, attachmentData, {
            contentType: part.mimeType,
          });

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
            email_source_id: processedEmailId,
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
          console.log('Bill extracted successfully:', bill.id);
        } else {
          console.error('Extraction failed:', await extractResponse.text());
        }
      } catch (error) {
        console.error('Error processing attachment:', error);
      }
    }
  }

  return billsCreated;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json();
    const { integrationId } = body;

    if (!integrationId) {
      throw new Error('integrationId is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials are missing');
    }

    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: integration, error: integrationError } = await supabase
      .from('gmail_integrations')
      .select('*')
      .eq('id', integrationId)
      .eq('is_active', true)
      .single();

    if (integrationError) throw integrationError;

    if (!integration.access_token) {
      throw new Error('No access token available');
    }

    const { google } = await import('npm:googleapis@128');
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: integration.access_token,
      refresh_token: integration.refresh_token,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const query = integration.subject_filters
      .map((filter: string) => `subject:${filter}`)
      .join(' OR ');

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `${query} has:attachment newer_than:7d`,
      maxResults: 20,
    });

    const messages = response.data.messages || [];
    console.log(`Found ${messages.length} messages to process`);

    let totalBillsCreated = 0;
    let totalProcessed = 0;

    for (const msg of messages) {
      try {
        const { data: existing } = await supabase
          .from('processed_emails')
          .select('id')
          .eq('integration_id', integrationId)
          .eq('email_id', msg.id)
          .maybeSingle();

        if (existing) {
          console.log('Email already processed:', msg.id);
          continue;
        }

        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
        });

        const message = fullMessage.data as GmailMessage;
        const subject = getHeader(message, 'subject');
        const sender = getHeader(message, 'from');

        if (!hasInvoiceKeyword(subject, integration.subject_filters)) {
          console.log('Subject does not match filters:', subject);
          continue;
        }

        const { data: processedEmail, error: processedError } = await supabase
          .from('processed_emails')
          .insert({
            integration_id: integrationId,
            email_id: msg.id,
            thread_id: msg.threadId,
            subject,
            sender,
            received_at: new Date(parseInt(message.internalDate)).toISOString(),
            status: 'pending',
            attachments_count: message.payload.parts?.filter((p) => p.filename).length || 0,
          })
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
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in gmail-sync:', error);

    if (body?.integrationId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseKey) {
        const { createClient } = await import('npm:@supabase/supabase-js@2');
        const supabase = createClient(supabaseUrl, supabaseKey);
        await supabase
          .from('gmail_integrations')
          .update({
            sync_status: 'error',
            error_message: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', body.integrationId);
      }
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});