CREATE TABLE maintenance_visits (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  ip         TEXT,
  country    TEXT,
  device     TEXT,
  browser    TEXT,
  os         TEXT,
  referrer   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE maintenance_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_insert" ON maintenance_visits FOR INSERT WITH CHECK (true);
CREATE POLICY "public_select" ON maintenance_visits FOR SELECT USING (true);
