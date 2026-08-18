const { db } = require('../config/firebaseAdmin');

const checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Access denied. Insufficient permissions.',
      });
    }

    next();
  };
};

async function requireAdmin(req, res, next) {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const role = userDoc.exists ? userDoc.data().role : req.user.role;
    req.user.role = role || req.user.role;
    if (role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  } catch (error) {
    res.status(403).json({ error: 'Admin only' });
  }
}

module.exports = { checkRole, requireAdmin };
