import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateTallyJSON(poData: any) {
  const data = poData.reviewed_data || poData.extracted_data;
  
  return {
    voucher_type: "Purchase",
    voucher_date: data.po_date,
    reference_number: data.po_number,
    party_name: data.client_name,
    items: data.items?.map((item: any) => ({
      item_name: item.item_name,
      quantity: item.qty,
      rate: item.rate,
      amount: item.amount || (item.qty * item.rate),
      gst_rate: item.gst || 18,
    })) || [],
    subtotal: data.subtotal,
    tax_amount: data.tax_amount,
    total_amount: data.total_amount,
    notes: data.notes,
    delivery_date: data.delivery_date,
  };
}

function generateTallyXML(poData: any) {
  const data = poData.reviewed_data || poData.extracted_data;
  
  const itemsXML = data.items?.map((item: any) => `
    <INVENTORYENTRIES.LIST>
      <STOCKITEMNAME>${item.item_name}</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <RATE>${item.rate}</RATE>
      <AMOUNT>${item.amount || (item.qty * item.rate)}</AMOUNT>
      <ACTUALQTY>${item.qty}</ACTUALQTY>
    </INVENTORYENTRIES.LIST>
  `).join('') || '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <VOUCHER REMOTEID="" VCHKEY="" VCHTYPE="Purchase" ACTION="Create">
            <DATE>${data.po_date}</DATE>
            <VOUCHERNUMBER>${data.po_number}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>${data.client_name}</PARTYLEDGERNAME>
            <REFERENCE>${data.po_number}</REFERENCE>
            <NARRATION>${data.notes || ''}</NARRATION>
            ${itemsXML}
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>${data.client_name}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${data.total_amount}</AMOUNT>
            </LEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { poId } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Generating Tally payload for PO:', poId);

    // Get PO record
    const { data: poDoc, error: fetchError } = await supabase
      .from('po_intake_documents')
      .select('*')
      .eq('id', poId)
      .single();

    if (fetchError) throw fetchError;

    // Generate Tally payloads
    const tallyJSON = generateTallyJSON(poDoc);
    const tallyXML = generateTallyXML(poDoc);

    console.log('Tally payloads generated');

    // Update PO record with Tally payloads
    const { data: updatedPo, error: updateError } = await supabase
      .from('po_intake_documents')
      .update({
        tally_json: tallyJSON,
        tally_xml: tallyXML,
        status: 'ready_for_tally',
      })
      .eq('id', poId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log('Tally payload generation completed successfully');

    return new Response(JSON.stringify({
      po: updatedPo,
      tally_json: tallyJSON,
      tally_xml: tallyXML,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in po-generate-tally:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});