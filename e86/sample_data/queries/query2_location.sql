SELECT
    user_id,
    profile.address.city,
    profile.address.zipcode,
    preferences.theme
FROM users
WHERE profile.address.city IS NOT NULL
