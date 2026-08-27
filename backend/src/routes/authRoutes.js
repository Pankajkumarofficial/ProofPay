import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} from '../validators/schemas.js';

const router = Router();

router.get('/config', auth.authConfig);
router.post('/register', authLimiter, validate({ body: registerSchema }), auth.register);
router.post('/login', authLimiter, validate({ body: loginSchema }), auth.login);
router.post('/logout', optionalAuth, auth.logout);
router.get('/me', requireAuth, auth.me);
router.get('/profile', requireAuth, auth.profileSummary);
router.patch('/profile', requireAuth, validate({ body: updateProfileSchema }), auth.updateProfile);
router.post('/password', requireAuth, validate({ body: changePasswordSchema }), auth.changePassword);

router.get('/google', authLimiter, auth.googleStart);
router.get('/google/callback', auth.googleCallback);

export default router;
