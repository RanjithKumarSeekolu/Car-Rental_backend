const { db, admin } = require('../config/firebaseAdmin');

const PROFILE_FIELDS = ['displayName', 'phoneNumber', 'photoURL', 'preferredLanguage'];

exports.getMe = async (req, res) => {
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

exports.updateMe = async (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};
    for (const key of PROFILE_FIELDS) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid profile fields to update' });
    }

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    const ref = db.collection('users').doc(req.user.uid);
    const doc = await ref.get();

    if (!doc.exists) {
      await ref.set({
        email: req.user.email || '',
        role: 'both',
        kycStatus: 'pending',
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...updates,
      });
    } else {
      await ref.update(updates);
    }

    const updated = await ref.get();
    res.json({ success: true, user: { uid: updated.id, ...updated.data() } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.submitKyc = async (req, res) => {
  try {
    const licenceNumber = String(req.body?.licenceNumber || '').trim();
    const licenceImage = String(req.body?.licenceImage || '').trim();
    if (!licenceNumber || licenceNumber.length < 6) {
      return res.status(400).json({ error: 'Enter a valid driving licence number' });
    }
    const imageOk = licenceImage.startsWith('http') || licenceImage.startsWith('data:image/');
    if (!imageOk) {
      return res.status(400).json({ error: 'Upload a photo of your driving licence' });
    }

    const ref = db.collection('users').doc(req.user.uid);
    const doc = await ref.get();
    const data = doc.exists ? doc.data() : {};
    if (data.role === 'admin') {
      return res.status(400).json({ error: 'Admin accounts do not need KYC' });
    }

    await ref.set(
      {
        email: req.user.email || data.email || '',
        licenceNumber,
        licenceImage,
        kycStatus: 'pending',
        kycSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
        kycRejectReason: '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const { sendMail } = require('../services/emailService');
    sendMail({
      to: process.env.CONTACT_INBOX || process.env.SMTP_USER || 'admin@rentnhost.com',
      type: 'kyc_submit',
      subject: 'KYC submitted — RentNHost',
      html: `<p>${data.displayName || req.user.email} submitted a driving licence (${licenceNumber}).</p>`,
    }).catch(() => {});

    const updated = await ref.get();
    res.json({ success: true, user: { uid: updated.id, ...updated.data() } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.reviewKyc = async (req, res) => {
  try {
    const { uid } = req.params;
    const status = req.body?.status === 'rejected' ? 'rejected' : 'verified';
    const reason = String(req.body?.reason || '').trim();

    const ref = db.collection('users').doc(uid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });

    await ref.update({
      kycStatus: status,
      kycReviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      kycRejectReason: status === 'rejected' ? reason : '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const user = doc.data();
    const { sendKYCStatusEmail } = require('../services/emailService');
    if (user.email) sendKYCStatusEmail(user.email, status, reason).catch(() => {});

    const updated = await ref.get();
    res.json({ success: true, user: { uid: updated.id, ...updated.data() } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
