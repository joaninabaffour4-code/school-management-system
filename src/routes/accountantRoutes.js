import express from 'express';
import { all } from '../config/database.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate);
router.use(authorize('accountant'));

router.get('/financial-report', async (req, res) => {
  const financialReport = await all(`
    SELECT o.id AS order_id, u.email, o.total_amount, o.status,
           COALESCE(SUM(p.amount), 0) AS total_paid,
           CASE WHEN COALESCE(SUM(p.amount), 0) >= o.total_amount THEN 'paid' ELSE 'pending' END AS payment_status
    FROM orders o
    JOIN users u ON u.id = o.user_id
    LEFT JOIN payments p ON p.order_id = o.id
    GROUP BY o.id, u.email, o.total_amount, o.status
    ORDER BY o.created_at DESC
  `);

  return res.json(financialReport);
});

router.get('/summary', async (req, res) => {
  const summary = await all(`
    SELECT
      COUNT(*) AS total_orders,
      COALESCE(SUM(total_amount), 0) AS total_revenue,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) AS completed_revenue
    FROM orders
  `);

  return res.json(summary[0]);
});

export default router;
