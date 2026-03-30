import { Router } from 'express';
import { registerUser, loginUser, renderLogin, renderRegister, render2FAVerify, verify2FALogin, verify2FASetup, enable2FA, disable2FA } from '../controllers/authController';
import { protect } from '../middleware/auth';

const router = Router();

// Render routes
router.get('/login', renderLogin);
router.get('/register', renderRegister);
router.get('/2fa', render2FAVerify);

// API routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/2fa', verify2FALogin);
router.post('/2fa-setup', verify2FASetup);

// Management
router.post('/2fa/enable', protect, enable2FA);
router.post('/2fa/disable', protect, disable2FA);

export default router;
