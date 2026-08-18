const { bucket } = require('../config/firebaseAdmin');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');

// Multer configuration for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images are allowed (jpeg, jpg, png, webp)'));
    }
  }
});

// Upload image to Firebase Storage
const uploadImage = async (file, folder = 'images') => {
  try {
    // Compress image
    const compressedImage = await sharp(file.buffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const fileName = `${folder}/${Date.now()}_${file.originalname}`;
    const fileUpload = bucket.file(fileName);

    await fileUpload.save(compressedImage, {
      metadata: {
        contentType: file.mimetype,
      },
    });

    // Make file publicly accessible
    await fileUpload.makePublic();

    return {
      fileName,
      url: `https://storage.googleapis.com/${bucket.name}/${fileName}`
    };
  } catch (error) {
    throw new Error(`Image upload failed: ${error.message}`);
  }
};

// Delete image from Firebase Storage
const deleteImage = async (fileName) => {
  try {
    await bucket.file(fileName).delete();
    return true;
  } catch (error) {
    throw new Error(`Image deletion failed: ${error.message}`);
  }
};

// Upload multiple images
const uploadMultipleImages = async (files, folder = 'images') => {
  const uploadPromises = files.map(file => uploadImage(file, folder));
  return await Promise.all(uploadPromises);
};

module.exports = {
  upload,
  uploadImage,
  deleteImage,
  uploadMultipleImages
};