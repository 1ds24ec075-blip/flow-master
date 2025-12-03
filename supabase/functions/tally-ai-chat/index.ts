import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SYSTEM_PROMPT = `You are TallyAI, an expert accounting and GST advisor with CA-level knowledge. Your role is to provide accurate, factual information about:

- Accounting principles and practices
- GST (Goods and Services Tax) in India
- Tax compliance and regulations
- Financial reporting and bookkeeping
- Business finance management
- Tally ERP software usage

IMPORTANT RULES:
1. NEVER make up or hallucinate data, numbers, rates, or facts
2. If you don't know something or are unsure, clearly state that
3. For specific tax rates or legal matters, always advise consulting official sources or a CA
4. Provide practical, actionable advice based on established accounting standards
5. Use clear, professional language
6. When discussing GST rates, remind users to verify with current GSTIN portal data
7. Stay focused on accounting, GST, and finance topics

You are helpful, professional, and precise in your responses.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { message, conversationId } = await req.json();

    if (!message || typeof message !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let currentConversationId = conversationId;

    if (!currentConversationId) {
      const { data: newConversation, error: convError } = await supabase
        .from('tally_ai_conversations')
        .insert({
          title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
        })
        .select()
        .single();

      if (convError) throw convError;
      currentConversationId = newConversation.id;
    }

    const { error: userMsgError } = await supabase
      .from('tally_ai_messages')
      .insert({
        conversation_id: currentConversationId,
        role: 'user',
        content: message,
      });

    if (userMsgError) throw userMsgError;

    const { data: previousMessages } = await supabase
      .from('tally_ai_messages')
      .select('role, content')
      .eq('conversation_id', currentConversationId)
      .order('created_at', { ascending: true })
      .limit(20);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(previousMessages || []),
    ];

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key is not configured');
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!openaiResponse.ok) {
      const error = await openaiResponse.text();
      console.error('OpenAI API error:', error);
      throw new Error('Failed to get response from OpenAI');
    }

    const openaiData = await openaiResponse.json();
    const assistantMessage = openaiData.choices[0].message.content;

    const { error: assistantMsgError } = await supabase
      .from('tally_ai_messages')
      .insert({
        conversation_id: currentConversationId,
        role: 'assistant',
        content: assistantMessage,
      });

    if (assistantMsgError) throw assistantMsgError;

    await supabase
      .from('tally_ai_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', currentConversationId);

    return new Response(
      JSON.stringify({
        conversationId: currentConversationId,
        message: assistantMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in tally-ai-chat:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});