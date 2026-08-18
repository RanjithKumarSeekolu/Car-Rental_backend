const { auth, db, admin } = require('../config/firebaseAdmin');

async function upsertUserFromToken(decodedToken, extras = {}) {
  const uid = decodedToken.uid;
  const ref = db.collection('users').doc(uid);
  const existing = await ref.get();

  if (existing.exists) {
    const data = existing.data();
    const updates = {
      email: decodedToken.email || data.email,
      photoURL: decodedToken.picture || data.photoURL || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (decodedToken.name) updates.displayName = decodedToken.name;
    else if (!data.displayName && extras.displayName) updates.displayName = extras.displayName;
    if (!data.kycStatus) updates.kycStatus = 'verified';
    await ref.update(updates);
    return { uid, ...data, ...updates, role: data.role || 'both', isNewUser: false };
  }

  const allowedRoles = new Set(['both', 'renter', 'host']);
  const role = allowedRoles.has(extras.role) ? extras.role : 'both';
  const user = {
    email: decodedToken.email || '',
    displayName: decodedToken.name || extras.displayName || '',
    photoURL: decodedToken.picture || '',
    phoneNumber: extras.phoneNumber || '',
    role,
    kycStatus: 'pending',
    preferredLanguage: 'en',
    rating: 0,
    totalBookings: 0,
    totalListings: 0,
    isActive: true,
    emailVerified: decodedToken.email_verified || false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await ref.set(user);
  await auth.setCustomUserClaims(uid, { role });
  return { uid, ...user, isNewUser: true };
}

// Client Firebase Auth is source of truth — sync profile to Firestore
exports.syncUser = async (req, res) => {
  try {
    const { idToken, role, phoneNumber, displayName } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: 'idToken required' });
    }

    const decoded = await auth.verifyIdToken(idToken);
    const user = await upsertUserFromToken(decoded, { role, phoneNumber, displayName });

    res.json({
      success: true,
      isNewUser: user.isNewUser,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        role: user.role || 'both',
        photoURL: user.photoURL,
        phoneNumber: user.phoneNumber || '',
        kycStatus: user.kycStatus || (user.isNewUser ? 'pending' : 'verified'),
        licenceNumber: user.licenceNumber || '',
        licenceImage: user.licenceImage || '',
        kycRejectReason: user.kycRejectReason || '',
      },
    });
    if (user.isNewUser && user.email) {
      const { sendWelcomeEmail } = require('../services/emailService');
      sendWelcomeEmail(user.email, user.displayName).catch(() => {});
    }
  } catch (error) {
    res.status(401).json({ error: error.message || 'Auth sync failed' });
  }
};

exports.register = async (req, res) => {
  try {
    const { email, password, phoneNumber, displayName, role } = req.body;
    const allowedRoles = new Set(['both', 'renter', 'host']);
    const nextRole = allowedRoles.has(role) ? role : 'both';
    const userRecord = await auth.createUser({ email, password, phoneNumber, displayName });

    await db.collection('users').doc(userRecord.uid).set({
      email,
      phoneNumber: phoneNumber || '',
      displayName: displayName || '',
      role: nextRole,
      kycStatus: 'pending',
      profilePhotoURL: '',
      rating: 0,
      totalBookings: 0,
      totalListings: 0,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await auth.setCustomUserClaims(userRecord.uid, { role: nextRole });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      userId: userRecord.uid,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  res.status(400).json({
    error: 'Use Firebase client SDK for email/password login, then POST /api/auth/sync with idToken',
  });
};

exports.googleSignIn = async (req, res) => {
  req.body.role = req.body.role || 'both';
  return exports.syncUser(req, res);
};

exports.googleSignUp = async (req, res) => {
  return exports.syncUser(req, res);
};

exports.logout = async (_req, res) => {
  res.json({ success: true, message: 'Logged out on client' });
};

exports.refreshToken = async (_req, res) => {
  res.status(400).json({ error: 'Refresh tokens via Firebase client SDK' });
};

exports.me = async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.user.uid).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    res.json({ success: true, user: { uid: doc.id, ...doc.data() } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
