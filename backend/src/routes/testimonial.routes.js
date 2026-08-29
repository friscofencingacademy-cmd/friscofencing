const express = require('express');
const multer = require('multer');

const {
  create,
  list,
  getById,
  update,
  remove,
  listPublic,
  uploadImage,
} = require('../controllers/testimonial.controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Wraps multer so a file-too-large (or otherwise malformed) upload comes
// back as a normal JSON 400 — same as spotlight.routes.js.
function uploadSingleImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) {
      return next();
    }

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Image must be 5MB or smaller' });
    }

    return res.status(400).json({ message: err.message || 'Failed to process the uploaded file' });
  });
}

// Literal-path routes registered BEFORE `/:id` below.
router.get('/public', listPublic);
router.post(
  '/upload-image',
  requireAuth,
  requireRole('admin', 'superadmin'),
  uploadSingleImage,
  uploadImage
);
router.get('/', requireAuth, requireRole('admin', 'superadmin'), list);
router.get('/:id', requireAuth, requireRole('admin', 'superadmin'), getById);
router.post('/', requireAuth, requireRole('admin', 'superadmin'), create);
router.put('/:id', requireAuth, requireRole('admin', 'superadmin'), update);
router.delete('/:id', requireAuth, requireRole('admin', 'superadmin'), remove);

module.exports = router;
