SELECT
    user_id,
    profile.name AS user_name,
    profile.email AS user_email
FROM users
WHERE profile.age > 18
