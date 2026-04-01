CREATE TABLE connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT NOT NULL,
  stranger_email TEXT,
  stranger_name TEXT,
  stranger_photo TEXT,
  room_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_access" ON connections FOR ALL USING (true) WITH CHECK (true);
