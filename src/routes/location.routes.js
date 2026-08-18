const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');
const { verifyToken } = require('../middlewares/auth');

router.get('/', locationController.getLocations);
router.get('/search', locationController.searchLocations);
router.post('/seed', verifyToken, locationController.seedLocations);
router.post('/', verifyToken, locationController.createLocation);
router.get('/:id', locationController.getLocationById);
router.patch('/:id', verifyToken, locationController.updateLocation);

module.exports = router;
