const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

// CORS_ORIGIN env var: comma-separated list of allowed origins.
// Always includes localhost for local dev.
const envOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = [
  'http://localhost:1234',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...envOrigins,
];

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/cars', require('./routes/car.routes'));
app.use('/api/bookings', require('./routes/booking.routes'));
app.use('/api/locations', require('./routes/location.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/payments', require('./routes/payment.routes'));
app.use('/api/contact', require('./routes/contact.routes'));
// Collections import/export — auth + admin (or ALLOW_SEED=true)
app.use('/api/collections', require('./routes/collection.routes'));

app.use((err, req, res, _next) => {
  console.error(err.stack);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: 'Something went wrong!',
    ...(isProd ? {} : { message: err.message }),
  });
});

module.exports = app;
