const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials are missing');
    }

    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    console.log('Gmail webhook received:', body);

    const message = body.message;
    if (!message || !message.data) {
      console.log('No message data in webhook');
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const decodedData = JSON.parse(atob(message.data));
    console.log('Decoded webhook data:', decodedData);

    const { emailAddress, historyId } = decodedData;

    const { data: integration, error: integrationError } = await supabase
      .from('gmail_integrations')
      .select('*')
      .eq('email_address', emailAddress)
      .eq('is_active', true)
      .maybeSingle();

    if (integrationError) throw integrationError;

    if (!integration) {
      console.log('No active integration found for:', emailAddress);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Triggering gmail-sync for integration:', integration.id);

    const syncUrl = `${supabaseUrl}/functions/v1/gmail-sync`;
    const syncResponse = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ integrationId: integration.id }),
    });

    if (!syncResponse.ok) {
      console.error('Failed to trigger sync:', await syncResponse.text());
    }

    await supabase
      .from('gmail_integrations')
      .update({
        history_id: historyId.toString(),
        last_sync_at: new Date().toISOString(),
      })
      .eq('id', integration.id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in gmail-webhook:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});