-- Seed file: 01_users.sql
-- Example seed data with idempotent inserts (ON CONFLICT DO NOTHING)

INSERT INTO users (id, name, email, created_at) VALUES
(1, 'Admin User', 'admin@example.com', NOW()),
(2, 'Test User', 'test@example.com', NOW()),
(3, 'John Doe', 'john@example.com', NOW())
ON CONFLICT (id) DO NOTHING;
