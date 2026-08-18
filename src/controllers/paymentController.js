const crypto = require('crypto');
const Razorpay = require('razorpay');
const { db, admin } = require('../config/firebaseAdmin');

function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim());
}

function demoSecret() {
  return process.env.RAZORPAY_KEY_SECRET?.trim() || 'rentnhost-demo-pay';
}

function sign(orderId, paymentId, secret) {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

function getClient() {
  if (!razorpayConfigured()) return null;
  const key_id = process.env.RAZORPAY_KEY_ID.trim();
  const key_secret = process.env.RAZORPAY_KEY_SECRET.trim();
  return { key_id, key_secret, client: new Razorpay({ key_id, key_secret }) };
}

async function loadPayableBooking(req, bookingId) {
  if (!bookingId) {
    const err = new Error('bookingId required');
    err.status = 400;
    throw err;
  }
  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  const booking = bookingDoc.data();
  if (booking.renterId !== req.user.uid) {
    const err = new Error('Not authorized');
    err.status = 403;
    throw err;
  }
  if (booking.status === 'cancelled') {
    const err = new Error('This booking was cancelled');
    err.status = 400;
    throw err;
  }
  if (booking.paymentStatus === 'paid') {
    const err = new Error('This booking is already paid');
    err.status = 400;
    throw err;
  }
  return { bookingRef, booking };
}

exports.getConfig = async (_req, res) => {
  const rzp = getClient();
  res.json({
    success: true,
    demo: !rzp,
    keyId: rzp?.key_id || 'demo',
    currency: 'INR',
  });
};

exports.initiatePayment = async (req, res) => {
  try {
    const { bookingId } = req.body || {};
    const { bookingRef, booking } = await loadPayableBooking(req, bookingId);
    const amountPaise = Math.round(Number(booking.totalPrice) * 100);
    if (amountPaise < 100) {
      return res.status(400).json({ error: 'Amount too small to charge' });
    }

    const description = `${booking.carMake || ''} ${booking.carModel || ''}`.trim() || 'RentNHost booking';
    const rzp = getClient();

    if (!rzp) {
      const orderId = `order_demo_${bookingId.slice(0, 12)}_${Date.now().toString(36)}`;
      const paymentId = `pay_demo_${crypto.randomBytes(8).toString('hex')}`;
      const signature = sign(orderId, paymentId, demoSecret());
      await bookingRef.update({
        razorpayOrderId: orderId,
        demoPaymentId: paymentId,
        paymentMethod: 'demo',
        paymentStatus: 'unpaid',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.json({
        success: true,
        demo: true,
        keyId: 'demo',
        orderId,
        paymentId,
        signature,
        amount: amountPaise,
        currency: 'INR',
        bookingId,
        description,
      });
    }

    const order = await rzp.client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: bookingId.slice(0, 40),
      notes: { bookingId },
    });

    await bookingRef.update({
      razorpayOrderId: order.id,
      paymentMethod: 'razorpay',
      paymentStatus: 'unpaid',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      demo: false,
      keyId: rzp.key_id,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      bookingId,
      description,
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { bookingId, orderId, paymentId, signature } = req.body || {};
    if (!bookingId || !orderId || !paymentId || !signature) {
      return res.status(400).json({ error: 'bookingId, orderId, paymentId, and signature are required' });
    }

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) return res.status(404).json({ error: 'Booking not found' });

    const booking = bookingDoc.data();
    if (booking.renterId !== req.user.uid) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (booking.razorpayOrderId && booking.razorpayOrderId !== orderId) {
      return res.status(400).json({ error: 'Order does not match this booking' });
    }

    const rzp = getClient();
    const secret = rzp ? rzp.key_secret : demoSecret();
    const expected = sign(orderId, paymentId, secret);
    if (expected !== signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }
    if (!rzp) {
      if (!orderId.startsWith('order_demo_') || booking.demoPaymentId !== paymentId) {
        return res.status(400).json({ error: 'Invalid demo payment' });
      }
    }

    await bookingRef.update({
      status: 'confirmed',
      paymentStatus: 'paid',
      paymentId,
      razorpayOrderId: orderId,
      transactionId: orderId,
      paymentMethod: rzp ? 'razorpay' : 'demo',
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const { sendBookingConfirmation } = require('../services/emailService');
    const details = {
      bookingId,
      carName: `${booking.carMake || ''} ${booking.carModel || ''}`.trim(),
      startDate: booking.startDate?.toDate?.()?.toISOString?.() || booking.startDate,
      endDate: booking.endDate?.toDate?.()?.toISOString?.() || booking.endDate,
      totalPrice: booking.totalPrice,
    };
    const notify = (uid, fallbackEmail) => {
      if (fallbackEmail) {
        sendBookingConfirmation(fallbackEmail, details).catch(() => {});
        return;
      }
      if (!uid) return;
      db.collection('users')
        .doc(uid)
        .get()
        .then((snap) => {
          const email = snap.exists ? snap.data().email : '';
          if (email) sendBookingConfirmation(email, details).catch(() => {});
        })
        .catch(() => {});
    };
    notify(booking.renterId, booking.renterEmail);
    if (booking.hostId && booking.hostId !== booking.renterId) {
      notify(booking.hostId, '');
    }

    res.json({ success: true, message: 'Payment verified', bookingId, paymentId });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
};

exports.refundPayment = async (_req, res) => {
  res.status(501).json({ error: 'Refunds not configured yet' });
};
