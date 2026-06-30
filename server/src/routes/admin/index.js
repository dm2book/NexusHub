/** Admin API surface. All routes require an authenticated staff user; each
 * sub-route additionally enforces fine-grained permissions via RBAC. */
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireStaff } from '../../middleware/rbac.js';
import orders from './orders.js';
import suppliers from './suppliers.js';
import fulfillment from './fulfillment.js';
import emails from './emails.js';
import analytics from './analytics.js';
import security from './security.js';
import products from './products.js';
import support from './support.js';
import social from './social.js';
import monetization from './monetization.js';

const router = Router();
router.use(requireAuth, requireStaff);

router.use('/orders', orders);
router.use('/suppliers', suppliers);
router.use('/fulfillment', fulfillment);
router.use('/emails', emails);
router.use('/analytics', analytics);
router.use('/security', security);
router.use('/products', products);
router.use('/support', support);
router.use('/social', social);
router.use('/monetization', monetization);

export default router;
