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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ingredients: {
        Row: {
          calib_factor: number
          cost_per_unit: number
          created_at: string
          current_stock: number
          id: string
          is_perishable: boolean
          name: string
          reorder_qty: number
          shelf_life_days: number | null
          storage_type: string
          threshold: number
          unit: string
          updated_at: string
          user_id: string
          vendor: string | null
          vendor_email: string | null
        }
        Insert: {
          calib_factor?: number
          cost_per_unit?: number
          created_at?: string
          current_stock?: number
          id?: string
          is_perishable?: boolean
          name: string
          reorder_qty?: number
          shelf_life_days?: number | null
          storage_type?: string
          threshold?: number
          unit?: string
          updated_at?: string
          user_id: string
          vendor?: string | null
          vendor_email?: string | null
        }
        Update: {
          calib_factor?: number
          cost_per_unit?: number
          created_at?: string
          current_stock?: number
          id?: string
          is_perishable?: boolean
          name?: string
          reorder_qty?: number
          shelf_life_days?: number | null
          storage_type?: string
          threshold?: number
          unit?: string
          updated_at?: string
          user_id?: string
          vendor?: string | null
          vendor_email?: string | null
        }
        Relationships: []
      }
      lots: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          ingredient_id: string
          lot_label: string
          quantity_received: number
          quantity_remaining: number
          received_at: string
          source: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          ingredient_id: string
          lot_label?: string
          quantity_received?: number
          quantity_remaining?: number
          received_at?: string
          source?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          ingredient_id?: string
          lot_label?: string
          quantity_received?: number
          quantity_remaining?: number
          received_at?: string
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lots_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          onboarding_completed: boolean
          restaurant_name: string | null
        }
        Insert: {
          created_at?: string
          id: string
          onboarding_completed?: boolean
          restaurant_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          onboarding_completed?: boolean
          restaurant_name?: string | null
        }
        Relationships: []
      }
      recipe_ingredients: {
        Row: {
          confidence: number
          id: string
          ingredient_id: string | null
          name: string
          qty: number
          recipe_id: string
          unit: string
          user_id: string
        }
        Insert: {
          confidence?: number
          id?: string
          ingredient_id?: string | null
          name: string
          qty?: number
          recipe_id: string
          unit?: string
          user_id: string
        }
        Update: {
          confidence?: number
          id?: string
          ingredient_id?: string | null
          name?: string
          qty?: number
          recipe_id?: string
          unit?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          id: string
          menu_price: number
          name: string
          status: string
          updated_at: string
          user_id: string
          verified_by: string | null
          verified_date: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          menu_price?: number
          name: string
          status?: string
          updated_at?: string
          user_id: string
          verified_by?: string | null
          verified_date?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          menu_price?: number
          name?: string
          status?: string
          updated_at?: string
          user_id?: string
          verified_by?: string | null
          verified_date?: string | null
        }
        Relationships: []
      }
      sales: {
        Row: {
          created_at: string
          id: string
          item: string
          qty: number
          reason: string | null
          source: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item: string
          qty?: number
          reason?: string | null
          source?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item?: string
          qty?: number
          reason?: string | null
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          created_at: string
          email: string | null
          id: string
          lead_time_days: number
          name: string
          notes: string | null
          phone: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          lead_time_days?: number
          name: string
          notes?: string | null
          phone?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          lead_time_days?: number
          name?: string
          notes?: string | null
          phone?: string | null
          user_id?: string
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
      [_ in never]: never
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
    Enums: {},
  },
} as const
