const fs = require('fs');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const {
  buildLocalUploadName,
  ensureUploadDir,
  getUploadPath,
  isRemoteMediaPath,
  uploadDir,
} = require('./media');

let cloudinaryConfigured = false;

function getMediaBackend() {
  return String(process.env.MEDIA_BACKEND || 'local').trim().toLowerCase();
}

function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function ensureCloudinaryConfigured() {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      'Cloudinary storage is enabled but CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are not fully configured.'
    );
  }
}

function configureCloudinary() {
  if (cloudinaryConfigured) {
    return;
  }

  ensureCloudinaryConfigured();
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  cloudinaryConfigured = true;
}

function buildCloudinaryFolder(folder) {
  const baseFolder = String(process.env.CLOUDINARY_FOLDER || 'cinema-rwanda')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const leafFolder = String(folder || 'media')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  return baseFolder ? `${baseFolder}/${leafFolder}` : leafFolder;
}

async function safeUnlink(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function parseCloudinaryAsset(reference) {
  if (!isRemoteMediaPath(reference)) {
    return null;
  }

  try {
    const url = new URL(reference);
    if (!url.hostname.includes('cloudinary.com')) {
      return null;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex < 2) {
      return null;
    }

    const resourceType = parts[1];
    let publicId = parts.slice(uploadIndex + 1).join('/');
    publicId = publicId.replace(/^v\d+\//, '');
    publicId = publicId.replace(/\.[^.\/]+$/, '');

    if (!publicId) {
      return null;
    }

    return { publicId: decodeURIComponent(publicId), resourceType };
  } catch {
    return null;
  }
}

async function uploadToCloudinary(file, { folder, resourceType }) {
  configureCloudinary();

  const uploadOptions = {
    folder: buildCloudinaryFolder(folder),
    invalidate: true,
    overwrite: false,
    resource_type: resourceType,
    unique_filename: true,
    use_filename: true,
  };

  return new Promise((resolve, reject) => {
    const done = (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    };

    if (resourceType === 'video') {
      cloudinary.uploader.upload_large(
        file.path,
        {
          ...uploadOptions,
          chunk_size: Number(process.env.CLOUDINARY_VIDEO_CHUNK_SIZE || 6_000_000),
        },
        done
      );
      return;
    }

    cloudinary.uploader.upload(file.path, uploadOptions, done);
  });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDir();
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, buildLocalUploadName(file.originalname)),
});

const upload = multer({ storage });

async function uploadAsset(file, options = {}) {
  if (!file) {
    return null;
  }

  const backend = getMediaBackend();
  const resourceType = options.resourceType || 'image';

  if (backend === 'cloudinary') {
    try {
      const result = await uploadToCloudinary(file, {
        folder: options.folder,
        resourceType,
      });

      return {
        provider: 'cloudinary',
        publicId: result.public_id,
        ref: result.secure_url,
        resourceType: result.resource_type || resourceType,
      };
    } finally {
      await safeUnlink(file.path);
    }
  }

  return {
    provider: 'local',
    ref: file.filename,
    resourceType,
  };
}

async function deleteStoredAsset(reference, options = {}) {
  if (!reference) {
    return;
  }

  if (isRemoteMediaPath(reference)) {
    if (!isCloudinaryConfigured()) {
      return;
    }

    const asset = parseCloudinaryAsset(reference);
    if (!asset) {
      return;
    }

    configureCloudinary();
    await new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(
        asset.publicId,
        {
          invalidate: true,
          resource_type: options.resourceType || asset.resourceType || 'image',
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    });
    return;
  }

  const filePath = getUploadPath(reference);
  if (!filePath) {
    return;
  }

  await safeUnlink(filePath);
}

module.exports = {
  deleteStoredAsset,
  getMediaBackend,
  isCloudinaryConfigured,
  upload,
  uploadAsset,
};
