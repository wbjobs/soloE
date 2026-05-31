
SELECT
    user_id,
    profile.name AS user_name,
    profile.email,
    profile.age,
    profile.address.city,
    profile.address.zipcode,
    preferences.theme
FROM users
WHERE profile.age > 25
