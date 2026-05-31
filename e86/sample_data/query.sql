-- Sample SQL query for lineage analysis
-- Joins orders, customers, and products tables
SELECT
    o.order_id,
    c.customer_name,
    p.product_name,
    o.quantity,
    o.unit_price,
    o.quantity * o.unit_price AS total_amount,
    o.order_date,
    o.status
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
JOIN products p ON o.product_id = p.product_id
WHERE o.status = 'completed'
