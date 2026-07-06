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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      categories: {
        Row: {
          color: string | null
          created_at: string
          icon: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          status: string
          target_date: string | null
          title: string
          user_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: string
          target_date?: string | null
          title: string
          user_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: string
          target_date?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_task_exceptions: {
        Row: {
          created_at: string
          date: string
          id: string
          recurring_rule_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          recurring_rule_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          recurring_rule_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_task_exceptions_recurring_rule_id_fkey"
            columns: ["recurring_rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_task_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_task_rules: {
        Row: {
          category_id: string | null
          created_at: string
          days_of_week: number[] | null
          duration_minutes: number | null
          goal_id: string | null
          id: string
          is_active: boolean
          rule_type: string
          scheduled_time: string | null
          time_period: string
          title: string
          user_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          days_of_week?: number[] | null
          duration_minutes?: number | null
          goal_id?: string | null
          id?: string
          is_active?: boolean
          rule_type: string
          scheduled_time?: string | null
          time_period?: string
          title: string
          user_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          days_of_week?: number[] | null
          duration_minutes?: number | null
          goal_id?: string | null
          id?: string
          is_active?: boolean
          rule_type?: string
          scheduled_time?: string | null
          time_period?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_task_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_task_rules_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_blocks: {
        Row: {
          block_type: string
          created_at: string
          date: string | null
          day_of_week: number | null
          end_time: string
          id: string
          is_protected: boolean
          is_recurring: boolean
          start_time: string
          title: string
          user_id: string
        }
        Insert: {
          block_type: string
          created_at?: string
          date?: string | null
          day_of_week?: number | null
          end_time: string
          id?: string
          is_protected?: boolean
          is_recurring?: boolean
          start_time: string
          title: string
          user_id: string
        }
        Update: {
          block_type?: string
          created_at?: string
          date?: string | null
          day_of_week?: number | null
          end_time?: string
          id?: string
          is_protected?: boolean
          is_recurring?: boolean
          start_time?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          category_id: string | null
          created_at: string
          date: string | null
          duration_minutes: number | null
          goal_id: string | null
          id: string
          is_completed: boolean
          is_ttfo: boolean
          notes: string | null
          recurring_rule_id: string | null
          scheduled_time: string | null
          time_period: string
          title: string
          user_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          date?: string | null
          duration_minutes?: number | null
          goal_id?: string | null
          id?: string
          is_completed?: boolean
          is_ttfo?: boolean
          notes?: string | null
          recurring_rule_id?: string | null
          scheduled_time?: string | null
          time_period?: string
          title: string
          user_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          date?: string | null
          duration_minutes?: number | null
          goal_id?: string | null
          id?: string
          is_completed?: boolean
          is_ttfo?: boolean
          notes?: string | null
          recurring_rule_id?: string | null
          scheduled_time?: string | null
          time_period?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurring_rule_id_fkey"
            columns: ["recurring_rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_task_rules"
            referencedColumns: ["id"]
          },
        ]
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

// App-level convenience aliases for the loosely-typed text columns above
// (Postgres CHECK constraints aren't reflected in the generated types).
export type TimePeriod = 'morning' | 'afternoon' | 'evening' | 'unscheduled'

// Derives the display bucket for a task from its scheduled time (Postgres
// `time` literal, e.g. "14:30:00"). Morning < 12pm, afternoon 12-5pm,
// evening >= 5pm; tasks with no start time are truly unscheduled.
export function getTimePeriod(scheduledTime?: string | null): TimePeriod {
  if (!scheduledTime) return 'unscheduled'
  const hour = parseInt(scheduledTime.split(':')[0], 10)
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

export type GoalStatus = 'active' | 'completed' | 'archived'
export type RecurrenceType = 'daily' | 'weekly' | 'custom'
export type ScheduleBlockType = 'commute' | 'date-night' | 'sleep' | 'custom'
