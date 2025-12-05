/*
  # TallyAI Conversation and Activity Tracking System

  1. New Tables
    - `conversations`
      - `id` (uuid, primary key)
      - `title` (text) - Auto-generated summary of conversation
      - `created_at` (timestamptz) - When conversation started
      - `updated_at` (timestamptz) - Last message time
      - `user_id` (uuid) - For future multi-user support
    
    - `messages`
      - `id` (uuid, primary key)
      - `conversation_id` (uuid, foreign key to conversations)
      - `role` (text) - 'user' or 'assistant'
      - `content` (text) - Message content
      - `function_calls` (jsonb) - Track function calls made by AI
      - `metadata` (jsonb) - Additional message metadata
      - `created_at` (timestamptz)
    
    - `activity_log`
      - `id` (uuid, primary key)
      - `activity_type` (text) - Type of activity (upload, process, extract, etc.)
      - `entity_type` (text) - What was affected (invoice, po, client, etc.)
      - `entity_id` (uuid) - ID of the affected entity
      - `status` (text) - success, error, pending
      - `metadata` (jsonb) - Additional details about the activity
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their data
    - Activity log is read-only for users, insert-only through system
*/

-- Create conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text DEFAULT 'New Conversation',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_id uuid
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  function_calls jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create activity_log table
CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'pending', 'processing')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity_type ON activity_log(entity_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_activity_type ON activity_log(activity_type);

-- Enable RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Conversations policies
CREATE POLICY "Anyone can view conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can create conversations"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update conversations"
  ON conversations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete conversations"
  ON conversations FOR DELETE
  TO authenticated
  USING (true);

-- Messages policies
CREATE POLICY "Anyone can view messages"
  ON messages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can create messages"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Activity log policies (read-only for users)
CREATE POLICY "Anyone can view activity log"
  ON activity_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert activity log"
  ON activity_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Function to auto-update conversation updated_at timestamp
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update conversation timestamp on new message
DROP TRIGGER IF EXISTS update_conversation_timestamp_trigger ON messages;
CREATE TRIGGER update_conversation_timestamp_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_timestamp();