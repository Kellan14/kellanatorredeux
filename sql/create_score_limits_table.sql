-- Create score_limits table to store machine score limits
CREATE TABLE IF NOT EXISTS score_limits (
  machine TEXT PRIMARY KEY,
  max_score BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_score_limits_machine ON score_limits(machine);

-- Insert existing limits from score_limits.json
INSERT INTO score_limits (machine, max_score) VALUES
  ('jaws', 10000000000),
  ('segagod', 1000000000),
  ('black knight sor', 5000000000),
  ('godzilla', 100000000000),
  ('tz', 10000000000)
ON CONFLICT (machine) DO NOTHING;

-- Enable Row Level Security (optional - remove if you want admin-only access)
ALTER TABLE score_limits ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read score limits
CREATE POLICY "Anyone can read score limits"
  ON score_limits
  FOR SELECT
  USING (true);

-- Only allow service role to insert/update/delete (via API)
CREATE POLICY "Service role can modify score limits"
  ON score_limits
  FOR ALL
  USING (auth.role() = 'service_role');
