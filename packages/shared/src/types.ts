/**
 * Tipos gerados a partir do schema Supabase (MCP user-supabase-take-me: generate_typescript_types).
 * Atualizado em: 2025-03-16
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** Linha de `public.fiscal_documents` (Spedy + Stripe). */
export type FiscalDocumentRow = {
  authorized_at: string | null
  created_at: string
  entity_id: string
  entity_type: string
  id: string
  integration_id: string
  last_spedy_event_id: string | null
  processing_code: string | null
  processing_message: string | null
  spedy_document_kind: string
  spedy_invoice_id: string | null
  spedy_invoice_model: string | null
  spedy_order_id: string | null
  status: string
  stripe_payment_intent_id: string
  updated_at: string
}

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      booking_ratings: {
        Row: {
          booking_id: string
          comment: string | null
          created_at: string
          id: string
          rating: number
        }
        Insert: {
          booking_id: string
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
        }
        Update: {
          booking_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_ratings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bases: {
        Row: {
          address: string
          city: string
          created_at: string
          id: string
          is_active: boolean
          lat: number | null
          lng: number | null
          name: string
          state: string | null
          updated_at: string
        }
        Insert: {
          address: string
          city: string
          created_at?: string
          id?: string
          is_active?: boolean
          lat?: number | null
          lng?: number | null
          name: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          city?: string
          created_at?: string
          id?: string
          is_active?: boolean
          lat?: number | null
          lng?: number | null
          name?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          admin_earning_cents: number
          amount_cents: number
          bags_count: number
          cancellation_reason: string | null
          created_at: string
          destination_address: string
          destination_lat: number
          destination_lng: number
          id: string
          origin_address: string
          origin_lat: number
          origin_lng: number
          paid_at: string | null
          passenger_count: number
          passenger_data: Json
          payment_method: string
          payment_method_id: string | null
          platform_fee_extra_debit_cents: number
          scheduled_trip_id: string
          status: string
          stripe_payment_intent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_earning_cents?: number
          amount_cents: number
          bags_count: number
          cancellation_reason?: string | null
          created_at?: string
          destination_address: string
          destination_lat: number
          destination_lng: number
          id?: string
          origin_address: string
          origin_lat: number
          origin_lng: number
          paid_at?: string | null
          passenger_count: number
          passenger_data?: Json
          payment_method?: string
          payment_method_id?: string | null
          platform_fee_extra_debit_cents?: number
          scheduled_trip_id: string
          status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_earning_cents?: number
          amount_cents?: number
          bags_count?: number
          cancellation_reason?: string | null
          created_at?: string
          destination_address?: string
          destination_lat?: number
          destination_lng?: number
          id?: string
          origin_address?: string
          origin_lat?: number
          origin_lng?: number
          paid_at?: string | null
          passenger_count?: number
          passenger_data?: Json
          payment_method?: string
          payment_method_id?: string | null
          platform_fee_extra_debit_cents?: number
          scheduled_trip_id?: string
          status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_scheduled_trip_id_fkey"
            columns: ["scheduled_trip_id"]
            isOneToOne: false
            referencedRelation: "scheduled_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      data_export_requests: {
        Row: {
          last_sent_at: string
          user_id: string
        }
        Insert: {
          last_sent_at?: string
          user_id: string
        }
        Update: {
          last_sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dependent_shipments: {
        Row: {
          amount_cents: number
          bags_count: number
          cancellation_reason: string | null
          contact_phone: string
          created_at: string
          dependent_id: string | null
          destination_address: string
          destination_lat: number | null
          destination_lng: number | null
          full_name: string
          id: string
          instructions: string | null
          origin_address: string
          origin_lat: number | null
          origin_lng: number | null
          payment_method: string
          rating: number | null
          receiver_name: string | null
          scheduled_at: string | null
          scheduled_trip_id: string | null
          status: string
          stripe_payment_intent_id: string | null
          tip_cents: number | null
          user_id: string
          when_option: string
        }
        Insert: {
          amount_cents: number
          bags_count?: number
          cancellation_reason?: string | null
          contact_phone: string
          created_at?: string
          dependent_id?: string | null
          destination_address: string
          destination_lat?: number | null
          destination_lng?: number | null
          full_name: string
          id?: string
          instructions?: string | null
          origin_address: string
          origin_lat?: number | null
          origin_lng?: number | null
          payment_method: string
          rating?: number | null
          receiver_name?: string | null
          scheduled_at?: string | null
          scheduled_trip_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          tip_cents?: number | null
          user_id: string
          when_option: string
        }
        Update: {
          amount_cents?: number
          bags_count?: number
          cancellation_reason?: string | null
          contact_phone?: string
          created_at?: string
          dependent_id?: string | null
          destination_address?: string
          destination_lat?: number | null
          destination_lng?: number | null
          full_name?: string
          id?: string
          instructions?: string | null
          origin_address?: string
          origin_lat?: number | null
          origin_lng?: number | null
          payment_method?: string
          rating?: number | null
          receiver_name?: string | null
          scheduled_at?: string | null
          scheduled_trip_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          tip_cents?: number | null
          user_id?: string
          when_option?: string
        }
        Relationships: [
          {
            foreignKeyName: "dependent_shipments_dependent_id_fkey"
            columns: ["dependent_id"]
            isOneToOne: false
            referencedRelation: "dependents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dependent_shipments_scheduled_trip_id_fkey"
            columns: ["scheduled_trip_id"]
            isOneToOne: false
            referencedRelation: "scheduled_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      dependents: {
        Row: {
          age: string | null
          created_at: string
          document_url: string | null
          full_name: string
          id: string
          observations: string | null
          representative_document_url: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          age?: string | null
          created_at?: string
          document_url?: string | null
          full_name: string
          id?: string
          observations?: string | null
          representative_document_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          age?: string | null
          created_at?: string
          document_url?: string | null
          full_name?: string
          id?: string
          observations?: string | null
          representative_document_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_verification_codes: {
        Row: {
          code: string
          created_at: string
          email: string
          expires_at: string
          id: string
        }
        Insert: {
          code: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
        }
        Update: {
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
        }
        Relationships: []
      }
      excursion_passengers: {
        Row: {
          age: string | null
          consent_document_url: string | null
          cpf: string | null
          created_at: string
          document_url: string | null
          excursion_request_id: string
          full_name: string
          gender: string | null
          guardian_document_url: string | null
          id: string
          observations: string | null
          phone: string | null
          photo_url: string | null
          status_departure: string | null
          status_return: string | null
          updated_at: string
        }
        Insert: {
          age?: string | null
          consent_document_url?: string | null
          cpf?: string | null
          created_at?: string
          document_url?: string | null
          excursion_request_id: string
          full_name: string
          gender?: string | null
          guardian_document_url?: string | null
          id?: string
          observations?: string | null
          phone?: string | null
          photo_url?: string | null
          status_departure?: string | null
          status_return?: string | null
          updated_at?: string
        }
        Update: {
          age?: string | null
          consent_document_url?: string | null
          cpf?: string | null
          created_at?: string
          document_url?: string | null
          excursion_request_id?: string
          full_name?: string
          gender?: string | null
          guardian_document_url?: string | null
          id?: string
          observations?: string | null
          phone?: string | null
          photo_url?: string | null
          status_departure?: string | null
          status_return?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "excursion_passengers_excursion_request_id_fkey"
            columns: ["excursion_request_id"]
            isOneToOne: false
            referencedRelation: "excursion_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      excursion_requests: {
        Row: {
          assignment_notes: Json | null
          budget_lines: Json | null
          children_team: boolean
          confirmed_at: string | null
          created_at: string
          destination: string
          driver_id: string | null
          excursion_date: string
          first_aid_team: boolean
          fleet_type: string
          id: string
          observations: string | null
          payment_method: string | null
          payment_method_id: string | null
          people_count: number
          preparer_id: string | null
          recreation_items: Json
          recreation_team: boolean
          scheduled_departure_at: string | null
          special_needs_team: boolean
          status: string
          stripe_payment_intent_id: string | null
          sub_status: string | null
          total_amount_cents: number | null
          user_id: string
          vehicle_details: Json | null
        }
        Insert: {
          assignment_notes?: Json | null
          budget_lines?: Json | null
          children_team?: boolean
          confirmed_at?: string | null
          created_at?: string
          destination: string
          driver_id?: string | null
          excursion_date: string
          first_aid_team?: boolean
          fleet_type: string
          id?: string
          observations?: string | null
          payment_method?: string | null
          payment_method_id?: string | null
          people_count?: number
          preparer_id?: string | null
          recreation_items?: Json
          recreation_team?: boolean
          scheduled_departure_at?: string | null
          special_needs_team?: boolean
          status?: string
          stripe_payment_intent_id?: string | null
          sub_status?: string | null
          total_amount_cents?: number | null
          user_id: string
          vehicle_details?: Json | null
        }
        Update: {
          assignment_notes?: Json | null
          budget_lines?: Json | null
          children_team?: boolean
          confirmed_at?: string | null
          created_at?: string
          destination?: string
          driver_id?: string | null
          excursion_date?: string
          first_aid_team?: boolean
          fleet_type?: string
          id?: string
          observations?: string | null
          payment_method?: string | null
          payment_method_id?: string | null
          people_count?: number
          preparer_id?: string | null
          recreation_items?: Json
          recreation_team?: boolean
          scheduled_departure_at?: string | null
          special_needs_team?: boolean
          status?: string
          stripe_payment_intent_id?: string | null
          sub_status?: string | null
          total_amount_cents?: number | null
          user_id?: string
          vehicle_details?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "excursion_requests_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_documents: {
        Row: FiscalDocumentRow
        Insert: {
          authorized_at?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          integration_id: string
          last_spedy_event_id?: string | null
          processing_code?: string | null
          processing_message?: string | null
          spedy_document_kind?: string
          spedy_invoice_id?: string | null
          spedy_invoice_model?: string | null
          spedy_order_id?: string | null
          status?: string
          stripe_payment_intent_id: string
          updated_at?: string
        }
        Update: {
          authorized_at?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          integration_id?: string
          last_spedy_event_id?: string | null
          processing_code?: string | null
          processing_message?: string | null
          spedy_document_kind?: string
          spedy_invoice_id?: string | null
          spedy_invoice_model?: string | null
          spedy_order_id?: string | null
          status?: string
          stripe_payment_intent_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      fiscal_spedy_webhook_events: {
        Row: {
          received_at: string
          spedy_event_id: string
        }
        Insert: {
          received_at?: string
          spedy_event_id: string
        }
        Update: {
          received_at?: string
          spedy_event_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          enabled: boolean
          key: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          key: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          key?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          category: string | null
          created_at: string
          id: string
          message: string | null
          read_at: string | null
          target_app_slug: string
          title: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          message?: string | null
          read_at?: string | null
          target_app_slug?: string
          title: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          message?: string | null
          read_at?: string | null
          target_app_slug?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          brand: string | null
          created_at: string
          expiry_month: number | null
          expiry_year: number | null
          holder_name: string | null
          id: string
          last_four: string | null
          provider: string | null
          provider_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          brand?: string | null
          created_at?: string
          expiry_month?: number | null
          expiry_year?: number | null
          holder_name?: string | null
          id?: string
          last_four?: string | null
          provider?: string | null
          provider_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          brand?: string | null
          created_at?: string
          expiry_month?: number | null
          expiry_year?: number | null
          holder_name?: string | null
          id?: string
          last_four?: string | null
          provider?: string | null
          provider_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          city: string | null
          cpf: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          rating: number | null
          state: string | null
          stripe_customer_id: string | null
          updated_at: string
          verified: boolean
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          cpf?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          rating?: number | null
          state?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          verified?: boolean
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          cpf?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          rating?: number | null
          state?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      profile_fcm_tokens: {
        Row: {
          app_slug: string
          fcm_token: string
          id: string
          platform: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          app_slug?: string
          fcm_token: string
          id?: string
          platform?: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          app_slug?: string
          fcm_token?: string
          id?: string
          platform?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_fcm_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recent_destinations: {
        Row: {
          address: string
          cep: string | null
          city: string
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          state: string | null
          used_at: string
          user_id: string
        }
        Insert: {
          address: string
          cep?: string | null
          city: string
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          state?: string | null
          used_at?: string
          user_id: string
        }
        Update: {
          address?: string
          cep?: string | null
          city?: string
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          state?: string | null
          used_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scheduled_trips: {
        Row: {
          amount_cents: number | null
          arrival_at: string
          badge: string | null
          bags_available: number
          created_at: string
          departure_at: string
          destination_address: string
          destination_lat: number
          destination_lng: number
          driver_id: string
          id: string
          origin_address: string
          origin_lat: number
          origin_lng: number
          seats_available: number
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          arrival_at: string
          badge?: string | null
          bags_available: number
          created_at?: string
          departure_at: string
          destination_address: string
          destination_lat: number
          destination_lng: number
          driver_id: string
          id?: string
          origin_address: string
          origin_lat: number
          origin_lng: number
          seats_available: number
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          arrival_at?: string
          badge?: string | null
          bags_available?: number
          created_at?: string
          departure_at?: string
          destination_address?: string
          destination_lat?: number
          destination_lng?: number
          driver_id?: string
          id?: string
          origin_address?: string
          origin_lat?: number
          origin_lng?: number
          seats_available?: number
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shipment_ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          rating: number
          shipment_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          shipment_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_ratings_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          amount_cents: number
          base_id: string | null
          cancellation_reason: string | null
          created_at: string
          delivered_at: string | null
          delivery_code: string | null
          destination_address: string
          destination_lat: number | null
          destination_lng: number | null
          delivery_notes: string | null
          driver_accepted_at: string | null
          driver_id: string | null
          id: string
          instructions: string | null
          origin_address: string
          origin_lat: number | null
          origin_lng: number | null
          package_size: string
          payment_method: string
          photo_url: string | null
          pickup_code: string | null
          pickup_notes: string | null
          picked_up_at: string | null
          recipient_email: string
          recipient_name: string
          recipient_phone: string
          scheduled_at: string | null
          scheduled_trip_id: string | null
          status: string
          stripe_payment_intent_id: string | null
          tip_cents: number | null
          user_id: string
          when_option: string
        }
        Insert: {
          amount_cents: number
          base_id?: string | null
          cancellation_reason?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_code?: string | null
          destination_address: string
          destination_lat?: number | null
          destination_lng?: number | null
          delivery_notes?: string | null
          driver_accepted_at?: string | null
          driver_id?: string | null
          id?: string
          instructions?: string | null
          origin_address: string
          origin_lat?: number | null
          origin_lng?: number | null
          package_size: string
          payment_method: string
          photo_url?: string | null
          pickup_code?: string | null
          pickup_notes?: string | null
          picked_up_at?: string | null
          recipient_email: string
          recipient_name: string
          recipient_phone: string
          scheduled_at?: string | null
          scheduled_trip_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          tip_cents?: number | null
          user_id: string
          when_option: string
        }
        Update: {
          amount_cents?: number
          base_id?: string | null
          cancellation_reason?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_code?: string | null
          destination_address?: string
          destination_lat?: number | null
          destination_lng?: number | null
          delivery_notes?: string | null
          driver_accepted_at?: string | null
          driver_id?: string | null
          id?: string
          instructions?: string | null
          origin_address?: string
          origin_lat?: number | null
          origin_lng?: number | null
          package_size?: string
          payment_method?: string
          photo_url?: string | null
          pickup_code?: string | null
          pickup_notes?: string | null
          picked_up_at?: string | null
          recipient_email?: string
          recipient_name?: string
          recipient_phone?: string
          scheduled_at?: string | null
          scheduled_trip_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          tip_cents?: number | null
          user_id?: string
          when_option?: string
        }
        Relationships: []
      }
      trip_stops: {
        Row: {
          address: string
          code: string | null
          created_at: string
          entity_id: string | null
          id: string
          label: string | null
          lat: number | null
          lng: number | null
          notes: string | null
          scheduled_trip_id: string
          sequence_order: number
          status: string
          stop_type: string
          updated_at: string
        }
        Insert: {
          address?: string
          code?: string | null
          created_at?: string
          entity_id?: string | null
          id?: string
          label?: string | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
          scheduled_trip_id: string
          sequence_order?: number
          status?: string
          stop_type: string
          updated_at?: string
        }
        Update: {
          address?: string
          code?: string | null
          created_at?: string
          entity_id?: string | null
          id?: string
          label?: string | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
          scheduled_trip_id?: string
          sequence_order?: number
          status?: string
          stop_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_stops_scheduled_trip_id_fkey"
            columns: ["scheduled_trip_id"]
            isOneToOne: false
            referencedRelation: "scheduled_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          key: string
          updated_at: string
          user_id: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          user_id: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          user_id?: string
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      enqueue_fiscal_document: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_stripe_payment_intent_id: string
        }
        Returns: FiscalDocumentRow
      }
      fiscal_document_for_entity: {
        Args: {
          p_entity_id: string
          p_entity_type: string
        }
        Returns: FiscalDocumentRow
      }
      fiscal_integration_id: {
        Args: {
          p_entity_id: string
          p_entity_type: string
        }
        Returns: string
      }
      upsert_profile_fcm_token: {
        Args: {
          p_app_slug?: string
          p_fcm_token: string
          p_platform?: string
        }
        Returns: undefined
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
