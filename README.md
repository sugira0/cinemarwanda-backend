# CINEMA Rwanda Backend

This is the active backend for the current deployed CINEMA Rwanda app.

The deployed frontend in `cinemarwandafront-end` rewrites API requests to:

```text
https://cinemarwanda-backend.vercel.app
```

Use this folder for backend fixes, backend deployment, and production environment variables.

Required production media storage variables:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
CLOUDINARY_FOLDER
CLOUDINARY_VIDEO_CHUNK_SIZE
MEDIA_BACKEND=cloudinary
```

There is also an older monorepo in `../rwandan-movies` with its own `server` folder. Keep it for reference unless intentionally migrating back to that monorepo.
