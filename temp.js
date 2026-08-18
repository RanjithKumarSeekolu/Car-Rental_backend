// ============================================
// BACKEND PROJECT STRUCTURE
// ============================================

/*
backend/
├── src/
│   ├── config/
│   │   ├── firebase.js          # Firebase Admin SDK config
│   │   ├── razorpay.js          # Payment gateway config
│   │   ├── twilio.js            # SMS config
│   │   └── constants.js         # App constants
│   ├── middleware/
│   │   ├── auth.js              # JWT verification
│   │   ├── roleCheck.js         # Role-based access
│   │   ├── validator.js         # Request validation
│   │   ├── errorHandler.js      # Global error handler
│   │   └── rateLimiter.js       # Rate limiting
│   ├── controllers/
│   │   ├── authController.js    # Authentication logic
│   │   ├── userController.js    # User CRUD
│   │   ├── carController.js     # Car listings
│   │   ├── bookingController.js # Booking management
│   │   ├── paymentController.js # Payment processing
│   │   ├── reviewController.js  # Reviews
│   │   ├── chatController.js    # Messaging
│   │   └── adminController.js   # Admin operations
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── car.routes.js
│   │   ├── booking.routes.js
│   │   ├── payment.routes.js
│   │   ├── review.routes.js
│   │   ├── chat.routes.js
│   │   └── admin.routes.js
│   ├── services/
│   │   ├── firebaseService.js   # Firestore operations
│   │   ├── storageService.js    # File uploads
│   │   ├── emailService.js      # Email notifications
│   │   ├── smsService.js        # SMS notifications
│   │   ├── kycService.js        # KYC verification
│   │   └── notificationService.js # Push notifications
│   ├── utils/
│   │   ├── logger.js            # Winston logger
│   │   ├── validators.js        # Validation schemas
│   │   └── helpers.js           # Helper functions
│   ├── app.js                   # Express app setup
│   └── server.js                # Server entry point
├── functions/                   # Firebase Cloud Functions
│   ├── index.js
│   ├── bookingTriggers.js
│   ├── paymentTriggers.js
│   └── notificationTriggers.js
├── .env
├── .env.example
├── package.json
└── README.md
*/

// ============================================
// 1. CONFIG - firebase.js
// ============================================

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET
});

const db = admin.firestore();
const auth = admin.auth();
const storage = admin.storage();
const messaging = admin.messaging();

module.exports = { admin, db, auth, storage, messaging };

// ============================================
// 2. MIDDLEWARE - auth.js
// ============================================

const { auth } = require('../config/firebase');

const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: decodedToken.role || 'renter'
    };
    
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { verifyToken };

// ============================================
// 3. MIDDLEWARE - roleCheck.js
// ============================================

const checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Access denied. Insufficient permissions.' 
      });
    }

    next();
  };
};

module.exports = { checkRole };

// ============================================
// 4. CONTROLLERS - authController.js
// ============================================

const { auth, db } = require('../config/firebase');
const { sendOTP, verifyOTP } = require('../services/smsService');

// Register new user
exports.register = async (req, res) => {
  try {
    const { email, password, phoneNumber, displayName, role } = req.body;

    // Create Firebase Auth user
    const userRecord = await auth.createUser({
      email,
      password,
      phoneNumber,
      displayName
    });

    // Store additional user data in Firestore
    await db.collection('users').doc(userRecord.uid).set({
      email,
      phoneNumber,
      displayName,
      role: role || 'renter',
      kycStatus: 'pending',
      profilePhotoURL: '',
      rating: 0,
      totalBookings: 0,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Set custom claims for role
    await auth.setCustomUserClaims(userRecord.uid, { role: role || 'renter' });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      userId: userRecord.uid
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Login (handled by Firebase client SDK, this is for custom token generation)
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Verify user exists in Firestore
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).limit(1).get();
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = snapshot.docs[0].data();
    
    // Create custom token
    const customToken = await auth.createCustomToken(snapshot.docs[0].id, {
      role: user.role
    });

    res.json({
      success: true,
      token: customToken,
      user: {
        uid: snapshot.docs[0].id,
        email: user.email,
        role: user.role,
        displayName: user.displayName
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Send OTP for phone verification
exports.sendOTP = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const result = await sendOTP(phoneNumber);
    
    res.json({
      success: true,
      message: 'OTP sent successfully',
      verificationId: result.verificationId
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Verify OTP
exports.verifyOTP = async (req, res) => {
  try {
    const { verificationId, code, phoneNumber } = req.body;
    const isValid = await verifyOTP(verificationId, code);
    
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Create or get user by phone number
    let userRecord;
    try {
      userRecord = await auth.getUserByPhoneNumber(phoneNumber);
    } catch (error) {
      // Create new user if doesn't exist
      userRecord = await auth.createUser({ phoneNumber });
      
      await db.collection('users').doc(userRecord.uid).set({
        phoneNumber,
        role: 'renter',
        kycStatus: 'pending',
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    const customToken = await auth.createCustomToken(userRecord.uid);
    
    res.json({
      success: true,
      token: customToken,
      userId: userRecord.uid
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ============================================
// 5. CONTROLLERS - carController.js
// ============================================

const { db } = require('../config/firebase');

// Create new car listing
exports.createCar = async (req, res) => {
  try {
    const carData = {
      hostId: req.user.uid,
      brand: req.body.brand,
      model: req.body.model,
      year: req.body.year,
      category: req.body.category,
      transmission: req.body.transmission,
      fuelType: req.body.fuelType,
      seats: req.body.seats,
      pricePerDay: req.body.pricePerDay,
      location: new admin.firestore.GeoPoint(
        req.body.location.lat,
        req.body.location.lng
      ),
      address: req.body.address,
      images: req.body.images || [],
      features: req.body.features || [],
      availability: [],
      rating: 0,
      totalReviews: 0,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const carRef = await db.collection('cars').add(carData);
    
    res.status(201).json({
      success: true,
      message: 'Car listed successfully',
      carId: carRef.id
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get car by ID
exports.getCarById = async (req, res) => {
  try {
    const carDoc = await db.collection('cars').doc(req.params.carId).get();
    
    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    res.json({
      success: true,
      car: {
        id: carDoc.id,
        ...carDoc.data()
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Search cars with filters
exports.searchCars = async (req, res) => {
  try {
    const {
      location,
      radius = 50,
      category,
      minPrice,
      maxPrice,
      transmission,
      seats,
      page = 1,
      limit = 20
    } = req.query;

    let query = db.collection('cars').where('isActive', '==', true);

    // Apply filters
    if (category) {
      query = query.where('category', '==', category);
    }
    if (transmission) {
      query = query.where('transmission', '==', transmission);
    }
    if (seats) {
      query = query.where('seats', '>=', parseInt(seats));
    }
    if (minPrice) {
      query = query.where('pricePerDay', '>=', parseFloat(minPrice));
    }
    if (maxPrice) {
      query = query.where('pricePerDay', '<=', parseFloat(maxPrice));
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.limit(parseInt(limit)).offset(offset);

    const snapshot = await query.get();
    const cars = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      cars,
      page: parseInt(page),
      totalResults: cars.length
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Update car listing
exports.updateCar = async (req, res) => {
  try {
    const { carId } = req.params;
    const carDoc = await db.collection('cars').doc(carId).get();

    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    // Verify ownership
    if (carDoc.data().hostId !== req.user.uid) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await db.collection('cars').doc(carId).update({
      ...req.body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Car updated successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ============================================
// 6. CONTROLLERS - bookingController.js
// ============================================

// Create booking
exports.createBooking = async (req, res) => {
  try {
    const { carId, startDate, endDate, pickupLocation, dropLocation } = req.body;
    
    // Get car details
    const carDoc = await db.collection('cars').doc(carId).get();
    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }
    
    const car = carDoc.data();
    
    // Calculate total price
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
    const totalPrice = days * car.pricePerDay;

    const bookingData = {
      carId,
      renterId: req.user.uid,
      hostId: car.hostId,
      startDate: admin.firestore.Timestamp.fromDate(new Date(startDate)),
      endDate: admin.firestore.Timestamp.fromDate(new Date(endDate)),
      totalPrice,
      status: 'pending',
      paymentStatus: 'pending',
      pickupLocation: new admin.firestore.GeoPoint(
        pickupLocation.lat,
        pickupLocation.lng
      ),
      dropLocation: new admin.firestore.GeoPoint(
        dropLocation.lat,
        dropLocation.lng
      ),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const bookingRef = await db.collection('bookings').add(bookingData);
    
    res.status(201).json({
      success: true,
      message: 'Booking created',
      bookingId: bookingRef.id,
      totalPrice
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Confirm booking (after payment)
exports.confirmBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { paymentId, transactionId } = req.body;

    await db.collection('bookings').doc(bookingId).update({
      status: 'confirmed',
      paymentStatus: 'paid',
      paymentId,
      transactionId,
      confirmedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Send notifications to host and renter
    // ... notification logic

    res.json({
      success: true,
      message: 'Booking confirmed'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Cancel booking
exports.cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;

    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingDoc.data();

    // Verify user can cancel
    if (booking.renterId !== req.user.uid && booking.hostId !== req.user.uid) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await db.collection('bookings').doc(bookingId).update({
      status: 'cancelled',
      cancellationReason: reason,
      cancelledBy: req.user.uid,
      cancelledAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Process refund if payment was made
    if (booking.paymentStatus === 'paid') {
      // ... refund logic
    }

    res.json({
      success: true,
      message: 'Booking cancelled'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ============================================
// 7. CONTROLLERS - paymentController.js
// ============================================

const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Initialize payment
exports.initiatePayment = async (req, res) => {
  try {
    const { bookingId, amount } = req.body;

    const options = {
      amount: amount * 100, // Convert to paise
      currency: 'INR',
      receipt: bookingId,
      payment_capture: 1
    };

    const order = await razorpay.orders.create(options);

    // Store transaction
    await db.collection('transactions').add({
      bookingId,
      userId: req.user.uid,
      amount,
      orderId: order.id,
      status: 'pending',
      paymentMethod: 'razorpay',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Verify payment
exports.verifyPayment = async (req, res) => {
  try {
    const {
      orderId,
      paymentId,
      signature,
      bookingId
    } = req.body;

    // Verify signature
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Update transaction
    const transactionQuery = await db.collection('transactions')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();

    if (!transactionQuery.empty) {
      await transactionQuery.docs[0].ref.update({
        paymentId,
        status: 'success',
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Update booking
    await db.collection('bookings').doc(bookingId).update({
      paymentStatus: 'paid',
      paymentId,
      transactionId: orderId
    });

    res.json({
      success: true,
      message: 'Payment verified successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Payment webhook
exports.paymentWebhook = async (req, res) => {
  try {
    const webhookBody = JSON.stringify(req.body);
    const signature = req.headers['x-razorpay-signature'];

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event = req.body.event;
    const paymentEntity = req.body.payload.payment.entity;

    // Handle different webhook events
    switch (event) {
      case 'payment.captured':
        // Payment successful
        console.log('Payment captured:', paymentEntity.id);
        break;
      case 'payment.failed':
        // Payment failed
        console.log('Payment failed:', paymentEntity.id);
        break;
      default:
        console.log('Unhandled event:', event);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ============================================
// 8. ROUTES - app setup
// ============================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/cars', require('./routes/car.routes'));
app.use('/api/bookings', require('./routes/booking.routes'));
app.use('/api/payments', require('./routes/payment.routes'));
app.use('/api/reviews', require('./routes/review.routes'));
app.use('/api/chats', require('./routes/chat.routes'));
app.use('/api/admin', require('./routes/admin.routes'));

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: err.message
  });
});

module.exports = app;

// ============================================
// 9. EXAMPLE ROUTE FILE - auth.routes.js
// ============================================

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/send-otp', authController.sendOTP);
router.post('/verify-otp', authController.verifyOTP);
router.post('/logout', verifyToken, authController.logout);
router.post('/refresh-token', authController.refreshToken);

module.exports = router;

// ============================================
// 10. FIREBASE CLOUD FUNCTIONS - index.js
// ============================================

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// Trigger when booking is created
exports.onBookingCreated = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const booking = snap.data();
    
    // Send notification to host
    const hostDoc = await admin.firestore()
      .collection('users')
      .doc(booking.hostId)
      .get();
    
    if (hostDoc.exists) {
      const hostData = hostDoc.data();
      
      // Send push notification
      if (hostData.fcmToken) {
        await admin.messaging().send({
          token: hostData.fcmToken,
          notification: {
            title: 'New Booking Request',
            body: 'You have a new booking request for your car'
          }
        });
      }
      
      // Send email
      // ... email logic
    }
  });

// Trigger when payment is successful
exports.onPaymentSuccess = functions.firestore
  .document('transactions/{transactionId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    
    // Check if status changed to success
    if (before.status === 'pending' && after.status === 'success') {
      // Update booking status
      await admin.firestore()
        .collection('bookings')
        .doc(after.bookingId)
        .update({
          status: 'confirmed',
          paymentStatus: 'paid'
        });
      
      // Send confirmation emails
      // ... email logic
    }
  });

// Scheduled function to check booking status
exports.checkBookingStatus = functions.pubsub
  .schedule('every 1 hours')
  .onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();
    
    // Get active bookings that should have started
    const snapshot = await admin.firestore()
      .collection('bookings')
      .where('status', '==', 'confirmed')
      .where('startDate', '<=', now)
      .get();
    
    const batch = admin.firestore().batch();
    
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, { status: 'ongoing' });
    });
    
    await batch.commit();
    console.log(`Updated ${snapshot.size} bookings to ongoing`);
  });

// ============================================
// 11. PACKAGE.JSON
// ============================================

/*
{
  "name": "car-rental-backend",
  "version": "1.0.0",
  "description": "Backend for Indian Car Rental Platform",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "deploy": "gcloud app deploy"
  },
  "dependencies": {
    "express": "^4.18.2",
    "firebase-admin": "^11.10.1",
    "razorpay": "^2.9.0",
    "twilio": "^4.14.0",
    "nodemailer": "^6.9.4",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "morgan": "^1.10.0",
    "dotenv": "^16.3.1",
    "joi": "^17.9.2",
    "winston": "^3.10.0",
    "express-rate-limit": "^6.9.0",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.32.4"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
*/

// ============================================
// 12. ENVIRONMENT VARIABLES (.env.example)
// ============================================

/*
# Server
PORT=3000
NODE_ENV=production

# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_STORAGE_BUCKET=your-bucket.appspot.com

# Razorpay
RAZORPAY_KEY_ID=your-key-id
RAZORPAY_KEY_SECRET=your-key-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret

# Twilio
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=your-twilio-number

# SendGrid
SENDGRID_API_KEY=your-sendgrid-key
SENDGRID_FROM_EMAIL=noreply@carrental.com

# Google Maps
GOOGLE_MAPS_API_KEY=your-google-maps-key

# Other
JWT_SECRET=your-jwt-secret
ENCRYPTION_KEY=your-encryption-key
*/