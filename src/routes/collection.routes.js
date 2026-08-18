const express = require('express');
const router = express.Router();
const collectionController = require('../controllers/collectionController');
const { verifyToken } = require('../middlewares/auth');
const { db } = require('../config/firebaseAdmin');

async function requireAdmin(req, res, next) {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const role = userDoc.exists ? userDoc.data().role : req.user.role;
    if (role !== 'admin' && process.env.ALLOW_SEED !== 'true') {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  } catch (error) {
    res.status(403).json({ error: 'Admin only' });
  }
}

router.use(verifyToken, requireAdmin);

router.get('/export', async (req, res) => {
  try {
    await collectionController.exportCollection('cars');
    res.json({ success: true, message: 'Export successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/import', async (req, res) => {
  try {
    await collectionController.importCollection('car', 'src/controllers/exports');
    res.json({ success: true, message: 'Import successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
