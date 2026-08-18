const multer = require('multer');

// store files in memory to stream to firebase storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB per file
});

module.exports = upload;
