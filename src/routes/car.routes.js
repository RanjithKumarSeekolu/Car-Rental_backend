const express = require('express');
const router = express.Router();
const carController = require('../controllers/carController');
const { getBookedDates } = require('../controllers/bookingController');
const { verifyToken } = require('../middlewares/auth');

// Public
router.get('/', carController.searchCars);
router.get('/nearby', carController.getNearbyCars);

// Host (auth) — must be before /:carId
router.get('/host/my-cars', verifyToken, carController.getHostCars);
router.post('/', verifyToken, carController.createCar);
router.put('/:carId', verifyToken, carController.updateCar);
router.patch('/:carId/status', verifyToken, carController.toggleCarStatus);
router.put('/:carId/availability', verifyToken, carController.updateAvailability);
router.delete('/:carId', verifyToken, carController.deleteCar);

// Public by id
router.get('/:carId/reviews', carController.getCarReviews);
router.post('/:carId/reviews', verifyToken, carController.createReview);
router.get('/:carId/booked-dates', getBookedDates);
router.get('/:carId/availability', carController.checkAvailability);
router.get('/:carId', carController.getCarById);

module.exports = router;
