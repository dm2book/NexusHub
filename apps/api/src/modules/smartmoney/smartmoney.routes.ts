import { Router } from 'express';
import { asyncHandler, ok } from '../../lib/http.js';
import { authenticate } from '../../middleware/auth.js';
import { getSmartMoneyBuys, getSmartWallets } from './smartmoney.service.js';

export const smartMoneyRouter = Router();
smartMoneyRouter.use(authenticate);

smartMoneyRouter.get(
  '/',
  asyncHandler(async (_req, res) => ok(res, await getSmartWallets())),
);

smartMoneyRouter.get(
  '/buys',
  asyncHandler(async (_req, res) => ok(res, await getSmartMoneyBuys())),
);
