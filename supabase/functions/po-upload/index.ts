const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing environment variables');
      throw new Error('Server configuration error');
    }

    console.log('Creating Supabase client');
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Parsing form data');
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const uploadedBy = formData.get('uploadedBy') as string;

    if (!file) {
      throw new Error('No file provided');
    }

    console.log('Uploading file:', file.name, file.type, file.size);

    const fileName = `${Date.now()}-${file.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('po-documents')
      .upload(fileName, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw uploadError;
    }

    console.log('File uploaded to storage:', uploadData.path);

    const { data: poData, error: poError } = await supabase
      .from('po_intake_documents')
      .insert({
        file_path: uploadData.path,
        file_name: file.name,
        file_type: file.type,
        uploaded_by: uploadedBy,
        status: 'uploaded',
      })
      .select()
      .single();

    if (poError) {
      console.error('Database error:', poError);
      throw poError;
    }

    console.log('PO intake record created:', poData.id);

    return new Response(JSON.stringify(poData), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error in po-upload:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
