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
          cost_per_unit: number
          created_at: string
          expires_at: string | null
          id: string
          ingredient_id: string
          lot_label: string
          notes: string | null
          quantity_received: number
          quantity_remaining: number
          received_at: string
          source: string | null
          user_id: string
          vendor: string | null
        }
        Insert: {
          cost_per_unit?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          ingredient_id: string
          lot_label?: string
          notes?: string | null
          quantity_received?: number
          quantity_remaining?: number
          received_at?: string
          source?: string | null
          user_id: string
          vendor?: string | null
        }
        Update: {
          cost_per_unit?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          ingredient_id?: string
          lot_label?: string
          notes?: string | null
          quantity_received?: number
          quantity_remaining?: number
          received_at?: string
          source?: string | null
          user_id?: string
          vendor?: string | null
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
      pos_connections: {
        Row: {
          access_token: string | null
          connected_at: string | null
          created_at: string
          error_message: string | null
          id: string
          last_sync_at: string | null
          location_id: string | null
          merchant_id: string | null
          metadata: Json | null
          pos_type: string
          refresh_token: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          location_id?: string | null
          merchant_id?: string | null
          metadata?: Json | null
          pos_type: string
          refresh_token?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          location_id?: string | null
          merchant_id?: string | null
          metadata?: Json | null
          pos_type?: string
          refresh_token?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pos_integrations: {
        Row: {
          access_token: string | null
          created_at: string
          external_location_id: string | null
          id: string
          last_synced_at: string | null
          provider: string
          refresh_token: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          external_location_id?: string | null
          id?: string
          last_synced_at?: string | null
          provider: string
          refresh_token?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          external_location_id?: string | null
          id?: string
          last_synced_at?: string | null
          provider?: string
          refresh_token?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pos_menu_items: {
        Row: {
          category: string | null
          created_at: string
          external_item_id: string
          external_variation_id: string | null
          id: string
          is_active: boolean
          last_synced_at: string | null
          name: string
          price_cents: number | null
          provider: string
          raw_payload: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          external_item_id: string
          external_variation_id?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name: string
          price_cents?: number | null
          provider: string
          raw_payload?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          external_item_id?: string
          external_variation_id?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name?: string
          price_cents?: number | null
          provider?: string
          raw_payload?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recipe_pos_mappings: {
        Row: {
          confidence_score: number | null
          created_at: string
          id: string
          mapping_status: string
          pos_menu_item_id: string
          recipe_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          mapping_status?: string
          pos_menu_item_id: string
          recipe_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          mapping_status?: string
          pos_menu_item_id?: string
          recipe_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_pos_mappings_pos_menu_item_id_fkey"
            columns: ["pos_menu_item_id"]
            isOneToOne: false
            referencedRelation: "pos_menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_pos_mappings_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
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
      pos_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          pos_type: string
          provider_client_id: string | null
          provider_client_secret: string | null
          redirect_origin: string
          state: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          pos_type: string
          provider_client_id?: string | null
          provider_client_secret?: string | null
          redirect_origin: string
          state: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          pos_type?: string
          provider_client_id?: string | null
          provider_client_secret?: string | null
          redirect_origin?: string
          state?: string
          used_at?: string | null
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
      convert_recipe_qty: {
        Args: {
          p_qty: number
          p_from: string
          p_to: string
        }
        Returns: number
      }
      record_sale_transaction: {
        Args: {
          p_item: string
          p_qty: number
          p_source?: string
          p_fefo?: boolean
        }
        Returns: {
          status: string
          reason: string | null
          sale_id: string
        }[]
      }
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
