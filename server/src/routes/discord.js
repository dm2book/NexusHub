/** Public Discord community info (live stats via widget when configured). */
import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { getServerInfo } from '../services/discordService.js';

const router = Router();

router.get('/server', asyncHandler(async (_req, res) => {
  res.json({ server: await getServerInfo() });
}));

export default router;
