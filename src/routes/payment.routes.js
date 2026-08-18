const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);
router.get('/config', paymentController.getConfig);
router.post('/initiate', paymentController.initiatePayment);
router.post('/verify', paymentController.verifyPayment);

module.exports = router;
