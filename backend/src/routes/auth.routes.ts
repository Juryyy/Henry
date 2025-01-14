import express from 'express';
import { authController, authValidation } from '../controllers/auth.controller';

const router = express.Router();

router.post('/register', authValidation.register, authController.register);
router.post('/login', authValidation.login, authController.login);
router.post('/2fa/setup', authController.setup2FA);
router.post('/2fa/verify', authController.verify2FA);

export default router;