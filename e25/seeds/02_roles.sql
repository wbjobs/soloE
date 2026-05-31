-- Seed file: 02_roles.sql
-- Example seed data for user roles

INSERT INTO roles (id, name, description) VALUES
(1, 'admin', 'Administrator with full access'),
(2, 'user', 'Regular user with limited access'),
(3, 'guest', 'Guest user with read-only access')
ON CONFLICT (id) DO NOTHING;

-- Insert user-role mappings
INSERT INTO user_roles (user_id, role_id) VALUES
(1, 1),
(2, 2),
(3, 2)
ON CONFLICT (user_id, role_id) DO NOTHING;
