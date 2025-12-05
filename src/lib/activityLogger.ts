import { supabase } from "@/integrations/supabase/client";

export type ActivityType =
  | 'upload'
  | 'process'
  | 'extract'
  | 'generate'
  | 'parse'
  | 'create'
  | 'update'
  | 'delete'
  | 'ai_query';

export type EntityType =
  | 'invoice'
  | 'po'
  | 'client'
  | 'supplier'
  | 'document'
  | 'bank_statement'
  | 'conversation'
  | 'approval';

export type ActivityStatus = 'success' | 'error' | 'pending' | 'processing';

interface LogActivityParams {
  activityType: ActivityType;
  entityType: EntityType;
  entityId?: string;
  status: ActivityStatus;
  metadata?: Record<string, any>;
}

export async function logActivity({
  activityType,
  entityType,
  entityId,
  status,
  metadata = {}
}: LogActivityParams): Promise<void> {
  try {
    const { error } = await supabase
      .from('activity_log')
      .insert({
        activity_type: activityType,
        entity_type: entityType,
        entity_id: entityId,
        status,
        metadata
      });

    if (error) {
      console.error('Failed to log activity:', error);
    }
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

export async function getRecentActivity(limit: number = 20) {
  try {
    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch activity log:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching activity log:', error);
    return [];
  }
}

export async function getActivityByType(activityType: ActivityType, limit: number = 20) {
  try {
    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('activity_type', activityType)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch activity log:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching activity log:', error);
    return [];
  }
}

export async function getActivityByEntity(entityType: EntityType, entityId: string) {
  try {
    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch activity log:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching activity log:', error);
    return [];
  }
}
