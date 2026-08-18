#!/usr/bin/env node
require('dotenv').config();
const { auth, db, admin } = require('../src/config/firebaseAdmin');

const EMAIL = process.env.ADMIN_EMAIL || 'admin@rentnhost.com';
const DISPLAY_NAME = 'RentNHost Admin';
const HOST_NAME = 'RentNHost';
const HOST_PHOTO =
  'https://ui-avatars.com/api/?name=RentNHost&background=0B1F3A&color=FF5C1A';
const SEED_HOST_ID = 'SEED_USER_ADMIN';
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'RentNHost!Admin26';

async function commitUpdates(items) {
  const SIZE = 400;
  for (let i = 0; i < items.length; i += SIZE) {
    const batch = db.batch();
    items.slice(i, i + SIZE).forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
}

async function main() {
  let created = false;
  let userRecord;

  try {
    userRecord = await auth.getUserByEmail(EMAIL);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    userRecord = await auth.createUser({
      email: EMAIL,
      password: DEFAULT_PASSWORD,
      displayName: DISPLAY_NAME,
      emailVerified: true,
    });
    created = true;
  }

  const uid = userRecord.uid;
  await auth.setCustomUserClaims(uid, { role: 'admin' });

  if (!created && process.env.ADMIN_PASSWORD) {
    await auth.updateUser(uid, { password: process.env.ADMIN_PASSWORD, displayName: DISPLAY_NAME });
  }

  await db.collection('users').doc(uid).set(
    {
      email: EMAIL,
      displayName: DISPLAY_NAME,
      photoURL: HOST_PHOTO,
      phoneNumber: '',
      role: 'admin',
      kycStatus: 'verified',
      preferredLanguage: 'en',
      rating: 5,
      totalBookings: 0,
      isActive: true,
      emailVerified: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const carSnap = await db.collection('car').where('hostId', '==', SEED_HOST_ID).get();
  await commitUpdates(
    carSnap.docs.map((doc) => ({
      ref: doc.ref,
      data: {
        hostId: uid,
        hostName: HOST_NAME,
        hostPhotoURL: HOST_PHOTO,
        isPlatformListing: true,
      },
    }))
  );

  const bookingSnap = await db.collection('bookings').where('hostId', '==', SEED_HOST_ID).get();
  await commitUpdates(bookingSnap.docs.map((doc) => ({ ref: doc.ref, data: { hostId: uid } })));

  const listed = await db.collection('car').where('hostId', '==', uid).get();
  await db.collection('users').doc(uid).set({ totalListings: listed.size }, { merge: true });

  console.log('Admin account ready');
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${created || process.env.ADMIN_PASSWORD ? DEFAULT_PASSWORD : '(unchanged)'}`);
  console.log(`  UID:      ${uid}`);
  console.log(`  Catalog cars assigned: ${carSnap.size}`);
  console.log(`  Bookings reassigned:   ${bookingSnap.size}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
