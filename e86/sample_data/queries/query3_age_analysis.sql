SELECT
    user_id,
    profile.name,
    profile.age,
    CASE 
        WHEN profile.age < 18 THEN 'minor'
        WHEN profile.age < 30 THEN 'young'
        WHEN profile.age < 50 THEN 'adult'
        ELSE 'senior'
    END AS age_group
FROM users
