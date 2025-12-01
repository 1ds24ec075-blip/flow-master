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
