import express from 'express';
import { all, get, run } from '../config/database.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate);
router.use(authorize('customer'));

router.get('/orders', async (req, res) => {
  const orders = await all('SELECT * FROM orders WHERE user_id = ?', [req.user.id]);
  return res.json(orders);
});

router.post('/orders', async (req, res) => {
  const { totalAmount, status } = req.body;

  if (!totalAmount || Number(totalAmount) <= 0) {
    return res.status(400).json({ message: 'A valid total amount is required' });
  }

  const orderId = await run(
    'INSERT INTO orders (user_id, total_amount, status) VALUES (?, ?, ?)',
    [req.user.id, Number(totalAmount), status || 'pending']
  );

  return res.status(201).json({ message: 'Order created successfully', orderId: orderId.id });
});

router.post('/orders/:id/pay', async (req, res) => {
  const { id } = req.params;
  const { amount, paymentMethod } = req.body;

  const order = await get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [id, req.user.id]);
  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ message: 'Valid payment amount is required' });
  }

  if (!paymentMethod) {
    return res.status(400).json({ message: 'Payment method is required' });
  }

  await run(
    'INSERT INTO payments (order_id, user_id, amount, payment_method, payment_status) VALUES (?, ?, ?, ?, ?)',
    [order.id, req.user.id, Number(amount), paymentMethod, 'completed']
  );

  const totalPaid = await get('SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE order_id = ?', [order.id]);

  if (Number(totalPaid.total_paid) >= Number(order.total_amount)) {
    await run('UPDATE orders SET status = ? WHERE id = ?', ['completed', order.id]);
  }

  return res.json({ message: 'Payment recorded successfully' });
});

export default router;
