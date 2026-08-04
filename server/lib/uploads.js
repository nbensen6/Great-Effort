const fs = require('fs');
const path = require('path');

// Single source of truth for where uploads land.
const uploadDir = process.env.NODE_ENV === 'production'
  ? '/data/uploads'
  : path.join(__dirname, '../uploads');

// Clips are the reason this is larger than the old 10MB image cap. A 15-30s
// 720p clip lands around 3-8MB, so 40MB leaves headroom without letting a
// single upload eat a meaningful share of the volume.
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

// The Fly volume is 1GB and also holds the SQLite database. If it fills, writes
// start failing and the app breaks in ways that look nothing like "disk full",
// so uploads stop well short of the ceiling.
const UPLOAD_BUDGET_BYTES = 700 * 1024 * 1024;

function usedBytes() {
  try {
    return fs.readdirSync(uploadDir).reduce((total, name) => {
      try {
        return total + fs.statSync(path.join(uploadDir, name)).size;
      } catch (e) {
        return total;
      }
    }, 0);
  } catch (e) {
    return 0; // directory not created yet
  }
}

function storageStatus() {
  const used = usedBytes();
  return {
    usedBytes: used,
    budgetBytes: UPLOAD_BUDGET_BYTES,
    remainingBytes: Math.max(0, UPLOAD_BUDGET_BYTES - used),
    usedPercent: Math.round((used / UPLOAD_BUDGET_BYTES) * 100)
  };
}

// Express middleware for use directly after a multer handler. Multer has
// already streamed the file to disk by this point, so an over-budget upload is
// removed again rather than left orphaned on the volume.
function enforceStorageBudget(req, res, next) {
  if (!req.file) return next();

  const { usedBytes: used, budgetBytes } = storageStatus();
  if (used <= budgetBytes) return next();

  try {
    fs.unlinkSync(path.join(uploadDir, req.file.filename));
  } catch (e) {
    console.error('Failed to remove over-budget upload:', e.message);
  }
  return res.status(507).json({
    error: 'Upload storage is full. Delete some clips or images before uploading more.'
  });
}

module.exports = {
  uploadDir,
  MAX_UPLOAD_BYTES,
  UPLOAD_BUDGET_BYTES,
  usedBytes,
  storageStatus,
  enforceStorageBudget
};
