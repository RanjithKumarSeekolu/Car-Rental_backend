const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/roleCheck');

router.use(verifyToken);
router.get('/stats', dashboardController.getStats);
router.get('/activity', dashboardController.getActivity);
router.get('/admin', requireAdmin, dashboardController.getAdminOverview);

module.exports = router;
