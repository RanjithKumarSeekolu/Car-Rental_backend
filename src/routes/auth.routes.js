const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const { verifyToken } = require('../middlewares/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/sync', authController.syncUser);
router.post('/google-signin', authController.googleSignIn);
router.post('/google-signup', authController.googleSignUp);
router.post('/logout', verifyToken, authController.logout);
router.post('/refresh-token', authController.refreshToken);
router.get('/me', verifyToken, authController.me);
router.patch('/me', verifyToken, userController.updateMe);

module.exports = router;
