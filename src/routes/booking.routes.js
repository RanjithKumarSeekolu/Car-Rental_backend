const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { verifyToken } = require('../middlewares/auth');

router.use(verifyToken);

router.post('/', bookingController.createBooking);
router.get('/mine', bookingController.getMyBookings);
router.get('/:bookingId', bookingController.getBookingById);
router.put('/:bookingId/confirm', bookingController.confirmBooking);
router.put('/:bookingId/cancel', bookingController.cancelBooking);

module.exports = router;
