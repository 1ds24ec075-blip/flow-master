export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          activity_type: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          status: string
        }
        Insert: {
          activity_type: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          status?: string
        }
        Update: {
          activity_type?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          status?: string
        }
        Relationships: []
      }
      approvals: {
        Row: {
          approved_by: string | null
          comment: string | null
          created_at: string | null
          id: string
          linked_invoice_id: string
          linked_invoice_type: string
          status: Database["public"]["Enums"]["approval_status"] | null
          updated_at: string | null
        }
        Insert: {
          approved_by?: string | null
          comment?: string | null
          created_at?: string | null
          id?: string
          linked_invoice_id: string
          linked_invoice_type: string
          status?: Database["public"]["Enums"]["approval_status"] | null
          updated_at?: string | null
        }
        Update: {
          approved_by?: string | null
          comment?: string | null
          created_at?: string | null
          id?: string
          linked_invoice_id?: string
          linked_invoice_type?: string
          status?: Database["public"]["Enums"]["approval_status"] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      bank_statements: {
        Row: {
          created_at: string
          error_message: string | null
          file_name: string
          id: string
          parsed_data: Json | null
          processed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          file_name: string
          id?: string
          parsed_data?: Json | null
          processed_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          file_name?: string
          id?: string
          parsed_data?: Json | null
          processed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      bank_transactions: {
        Row: {
          amount: number | null
          created_at: string
          description: string | null
          id: string
          statement_id: string
          transaction_date: string | null
          transaction_type: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          description?: string | null
          id?: string
          statement_id: string
          transaction_date?: string | null
          transaction_type?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          description?: string | null
          id?: string
          statement_id?: string
          transaction_date?: string | null
          transaction_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          bank_transaction_id: string | null
          bank_verified: boolean | null
          bill_date: string | null
          bill_number: string | null
          category_id: string | null
          created_at: string
          extraction_confidence: number | null
          id: string
          image_url: string | null
          is_verified: boolean | null
          payment_status: string
          total_amount: number
          updated_at: string
          vendor_gst: string | null
          vendor_name: string
          vendor_tin: string | null
          verified_at: string | null
          verified_date: string | null
        }
        Insert: {
          bank_transaction_id?: string | null
          bank_verified?: boolean | null
          bill_date?: string | null
          bill_number?: string | null
          category_id?: string | null
          created_at?: string
          extraction_confidence?: number | null
          id?: string
          image_url?: string | null
          is_verified?: boolean | null
          payment_status?: string
          total_amount?: number
          updated_at?: string
          vendor_gst?: string | null
          vendor_name: string
          vendor_tin?: string | null
          verified_at?: string | null
          verified_date?: string | null
        }
        Update: {
          bank_transaction_id?: string | null
          bank_verified?: boolean | null
          bill_date?: string | null
          bill_number?: string | null
          category_id?: string | null
          created_at?: string
          extraction_confidence?: number | null
          id?: string
          image_url?: string | null
          is_verified?: boolean | null
          payment_status?: string
          total_amount?: number
          updated_at?: string
          vendor_gst?: string | null
          vendor_name?: string
          vendor_tin?: string | null
          verified_at?: string | null
          verified_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bills_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invoices: {
        Row: {
          amount: number | null
          client_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          invoice_file: string | null
          invoice_number: string
          po_id: string | null
          status: Database["public"]["Enums"]["invoice_status"] | null
          tally_data: Json | null
          tally_uploaded: boolean | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          invoice_file?: string | null
          invoice_number: string
          po_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"] | null
          tally_data?: Json | null
          tally_uploaded?: boolean | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          invoice_file?: string | null
          invoice_number?: string
          po_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"] | null
          tally_data?: Json | null
          tally_uploaded?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invoices_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string | null
          email: string | null
          gst_number: string | null
          id: string
          name: string
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          name: string
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_master: {
        Row: {
          billing_address: string | null
          created_at: string | null
          currency: string | null
          customer_name: string
          email: string | null
          gst_number: string | null
          id: string
          is_active: boolean | null
          payment_terms: string | null
          phone: string | null
          shipping_address: string | null
          tally_ledger_name: string | null
          updated_at: string | null
        }
        Insert: {
          billing_address?: string | null
          created_at?: string | null
          currency?: string | null
          customer_name: string
          email?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean | null
          payment_terms?: string | null
          phone?: string | null
          shipping_address?: string | null
          tally_ledger_name?: string | null
          updated_at?: string | null
        }
        Update: {
          billing_address?: string | null
          created_at?: string | null
          currency?: string | null
          customer_name?: string
          email?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean | null
          payment_terms?: string | null
          phone?: string | null
          shipping_address?: string | null
          tally_ledger_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      expense_line_items: {
        Row: {
          amount: number | null
          bill_id: string | null
          created_at: string | null
          id: string
          item_description: string | null
          quantity: number | null
          tax_rate: number | null
          unit_price: number | null
        }
        Insert: {
          amount?: number | null
          bill_id?: string | null
          created_at?: string | null
          id?: string
          item_description?: string | null
          quantity?: number | null
          tax_rate?: number | null
          unit_price?: number | null
        }
        Update: {
          amount?: number | null
          bill_id?: string | null
          created_at?: string | null
          id?: string
          item_description?: string | null
          quantity?: number | null
          tax_rate?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_line_items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_matches: {
        Row: {
          created_at: string
          expense_name: string
          id: string
          matched_amount: number | null
          transaction_id: string
        }
        Insert: {
          created_at?: string
          expense_name: string
          id?: string
          matched_amount?: number | null
          transaction_id: string
        }
        Update: {
          created_at?: string
          expense_name?: string
          id?: string
          matched_amount?: number | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_matches_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          function_calls: Json | null
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          function_calls?: Json | null
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          function_calls?: Json | null
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      po_intake_documents: {
        Row: {
          confidence_scores: Json | null
          created_at: string
          extracted_data: Json | null
          file_name: string
          file_path: string
          file_type: string
          id: string
          reviewed_data: Json | null
          status: string
          tally_json: Json | null
          tally_xml: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          confidence_scores?: Json | null
          created_at?: string
          extracted_data?: Json | null
          file_name: string
          file_path: string
          file_type: string
          id?: string
          reviewed_data?: Json | null
          status?: string
          tally_json?: Json | null
          tally_xml?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          confidence_scores?: Json | null
          created_at?: string
          extracted_data?: Json | null
          file_name?: string
          file_path?: string
          file_type?: string
          id?: string
          reviewed_data?: Json | null
          status?: string
          tally_json?: Json | null
          tally_xml?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      po_order_items: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          item_number: number | null
          po_order_id: string
          quantity: number | null
          total_price: number | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          item_number?: number | null
          po_order_id: string
          quantity?: number | null
          total_price?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          item_number?: number | null
          po_order_id?: string
          quantity?: number | null
          total_price?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "po_order_items_po_order_id_fkey"
            columns: ["po_order_id"]
            isOneToOne: false
            referencedRelation: "po_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      po_orders: {
        Row: {
          billing_address: string | null
          created_at: string | null
          currency: string | null
          customer_address: string | null
          customer_master_id: string | null
          customer_match_log: Json | null
          customer_name: string | null
          delivery_date: string | null
          email_date: string | null
          email_from: string | null
          email_subject: string | null
          gst_number: string | null
          id: string
          order_date: string | null
          original_filename: string | null
          payment_terms: string | null
          po_number: string | null
          populated_at: string | null
          population_source: string | null
          price_mismatch_details: Json | null
          raw_text: string | null
          shipping_address: string | null
          source_customer_master_id: string | null
          status: string | null
          tally_ledger_name: string | null
          total_amount: number | null
          updated_at: string | null
          vendor_address: string | null
          vendor_name: string | null
        }
        Insert: {
          billing_address?: string | null
          created_at?: string | null
          currency?: string | null
          customer_address?: string | null
          customer_master_id?: string | null
          customer_match_log?: Json | null
          customer_name?: string | null
          delivery_date?: string | null
          email_date?: string | null
          email_from?: string | null
          email_subject?: string | null
          gst_number?: string | null
          id?: string
          order_date?: string | null
          original_filename?: string | null
          payment_terms?: string | null
          po_number?: string | null
          populated_at?: string | null
          population_source?: string | null
          price_mismatch_details?: Json | null
          raw_text?: string | null
          shipping_address?: string | null
          source_customer_master_id?: string | null
          status?: string | null
          tally_ledger_name?: string | null
          total_amount?: number | null
          updated_at?: string | null
          vendor_address?: string | null
          vendor_name?: string | null
        }
        Update: {
          billing_address?: string | null
          created_at?: string | null
          currency?: string | null
          customer_address?: string | null
          customer_master_id?: string | null
          customer_match_log?: Json | null
          customer_name?: string | null
          delivery_date?: string | null
          email_date?: string | null
          email_from?: string | null
          email_subject?: string | null
          gst_number?: string | null
          id?: string
          order_date?: string | null
          original_filename?: string | null
          payment_terms?: string | null
          po_number?: string | null
          populated_at?: string | null
          population_source?: string | null
          price_mismatch_details?: Json | null
          raw_text?: string | null
          shipping_address?: string | null
          source_customer_master_id?: string | null
          status?: string | null
          tally_ledger_name?: string | null
          total_amount?: number | null
          updated_at?: string | null
          vendor_address?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_po_orders_customer_master"
            columns: ["customer_master_id"]
            isOneToOne: false
            referencedRelation: "customer_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_po_orders_source_customer_master"
            columns: ["source_customer_master_id"]
            isOneToOne: false
            referencedRelation: "customer_master"
            referencedColumns: ["id"]
          },
        ]
      }
      price_list: {
        Row: {
          created_at: string | null
          currency: string | null
          id: string
          product_name: string | null
          sku: string
          unit_price: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          id?: string
          product_name?: string | null
          sku: string
          unit_price: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          id?: string
          product_name?: string | null
          sku?: string
          unit_price?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          amount: number | null
          client_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          material_items: Json | null
          po_details: string | null
          po_number: string
          quotation_id: string | null
          status: Database["public"]["Enums"]["po_status"] | null
          supplier_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          material_items?: Json | null
          po_details?: string | null
          po_number: string
          quotation_id?: string | null
          status?: Database["public"]["Enums"]["po_status"] | null
          supplier_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          material_items?: Json | null
          po_details?: string | null
          po_number?: string
          quotation_id?: string | null
          status?: Database["public"]["Enums"]["po_status"] | null
          supplier_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          amount: number | null
          client_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          informal_text_quotation: string | null
          quotation_number: string
          status: Database["public"]["Enums"]["quotation_status"] | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          informal_text_quotation?: string | null
          quotation_number: string
          status?: Database["public"]["Enums"]["quotation_status"] | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          informal_text_quotation?: string | null
          quotation_number?: string
          status?: Database["public"]["Enums"]["quotation_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_invoices: {
        Row: {
          amount: number | null
          created_at: string | null
          extracted_data: Json | null
          id: string
          invoice_file: string | null
          invoice_number: string
          po_id: string | null
          status: Database["public"]["Enums"]["invoice_status"] | null
          supplier_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          extracted_data?: Json | null
          id?: string
          invoice_file?: string | null
          invoice_number: string
          po_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"] | null
          supplier_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          extracted_data?: Json | null
          id?: string
          invoice_file?: string | null
          invoice_number?: string
          po_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"] | null
          supplier_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_invoices_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_material_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      segregated_transactions: {
        Row: {
          amount: number
          confidence_score: number | null
          created_at: string
          final_category: string | null
          id: string
          is_reviewed: boolean | null
          narration: string | null
          suggested_category: string
          transaction_date: string | null
          transaction_type: string
          upload_id: string
        }
        Insert: {
          amount?: number
          confidence_score?: number | null
          created_at?: string
          final_category?: string | null
          id?: string
          is_reviewed?: boolean | null
          narration?: string | null
          suggested_category?: string
          transaction_date?: string | null
          transaction_type: string
          upload_id: string
        }
        Update: {
          amount?: number
          confidence_score?: number | null
          created_at?: string
          final_category?: string | null
          id?: string
          is_reviewed?: boolean | null
          narration?: string | null
          suggested_category?: string
          transaction_date?: string | null
          transaction_type?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "segregated_transactions_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "segregation_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      segregation_rules: {
        Row: {
          business_name: string | null
          category: string
          created_at: string
          id: string
          pattern: string
          updated_at: string
          usage_count: number | null
        }
        Insert: {
          business_name?: string | null
          category: string
          created_at?: string
          id?: string
          pattern: string
          updated_at?: string
          usage_count?: number | null
        }
        Update: {
          business_name?: string | null
          category?: string
          created_at?: string
          id?: string
          pattern?: string
          updated_at?: string
          usage_count?: number | null
        }
        Relationships: []
      }
      segregation_uploads: {
        Row: {
          account_name: string | null
          business_name: string | null
          created_at: string
          file_name: string
          id: string
          status: string
          total_transactions: number | null
          updated_at: string
          upload_date: string
        }
        Insert: {
          account_name?: string | null
          business_name?: string | null
          created_at?: string
          file_name: string
          id?: string
          status?: string
          total_transactions?: number | null
          updated_at?: string
          upload_date?: string
        }
        Update: {
          account_name?: string | null
          business_name?: string | null
          created_at?: string
          file_name?: string
          id?: string
          status?: string
          total_transactions?: number | null
          updated_at?: string
          upload_date?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          created_at: string | null
          email: string | null
          gst_number: string | null
          id: string
          material_type: string | null
          name: string
          notes: string | null
          payment_terms: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          material_type?: string | null
          name: string
          notes?: string | null
          payment_terms?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          material_type?: string | null
          name?: string
          notes?: string | null
          payment_terms?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          user_email: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["user_role"]
          user_email: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_email?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      approval_status: "pending" | "approved" | "rejected"
      invoice_status: "pending" | "awaiting_approval" | "approved" | "rejected"
      po_status:
        | "draft"
        | "sent"
        | "processing"
        | "materials_received"
        | "completed"
      quotation_status: "draft" | "sent" | "approved" | "rejected"
      user_role:
        | "quotation_officer"
        | "invoice_officer"
        | "approval_manager"
        | "admin"
        | "client_portal"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      approval_status: ["pending", "approved", "rejected"],
      invoice_status: ["pending", "awaiting_approval", "approved", "rejected"],
      po_status: [
        "draft",
        "sent",
        "processing",
        "materials_received",
        "completed",
      ],
      quotation_status: ["draft", "sent", "approved", "rejected"],
      user_role: [
        "quotation_officer",
        "invoice_officer",
        "approval_manager",
        "admin",
        "client_portal",
      ],
    },
  },
} as const
