const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/roleCheck');

router.get('/me', verifyToken, userController.getMe);
router.patch('/me', verifyToken, userController.updateMe);
router.post('/me/kyc', verifyToken, userController.submitKyc);
router.patch('/:uid/kyc', verifyToken, requireAdmin, userController.reviewKyc);

module.exports = router;
