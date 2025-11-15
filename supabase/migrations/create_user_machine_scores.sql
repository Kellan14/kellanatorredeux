-- Create user_machine_scores table
CREATE TABLE IF NOT EXISTS user_machine_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  machine TEXT NOT NULL,
  score BIGINT NOT NULL,
  venue TEXT NOT NULL,
  played_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  include_in_calculations BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_machine_scores_user_id ON user_machine_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_user_machine_scores_player_name ON user_machine_scores(player_name);
CREATE INDEX IF NOT EXISTS idx_user_machine_scores_machine ON user_machine_scores(machine);
CREATE INDEX IF NOT EXISTS idx_user_machine_scores_score ON user_machine_scores(score DESC);

-- Enable Row Level Security
ALTER TABLE user_machine_scores ENABLE ROW LEVEL SECURITY;

-- Create policies
-- Users can view all scores
CREATE POLICY "Users can view all scores"
  ON user_machine_scores
  FOR SELECT
  USING (true);

-- Users can insert their own scores
CREATE POLICY "Users can insert their own scores"
  ON user_machine_scores
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own scores
CREATE POLICY "Users can update their own scores"
  ON user_machine_scores
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own scores
CREATE POLICY "Users can delete their own scores"
  ON user_machine_scores
  FOR DELETE
  USING (auth.uid() = user_id);
