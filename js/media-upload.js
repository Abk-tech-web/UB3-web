// ============================================================================
// UB3 — Post media helpers (multi-image + video)
// Shared by the dashboard composer/editor. Handles client-side image
// compression, video validation, and media upload/delete with progress
// reporting. Kept separate from dashboard.js so it can be reused by both
// the "new post" composer and the "edit post" flow.
//
// UPLOAD BACKEND: Cloudinary (unsigned uploads), NOT Firebase Storage.
// ---------------------------------------------------------------------
// As of Feb 2026, Firebase Storage requires the paid Blaze plan just to
// provision a bucket — even for $0 actual usage. To avoid that billing
// requirement entirely, all post media (images + video) uploads straight
// from the browser to Cloudinary's free tier instead. Firebase Auth and
// Firestore are untouched; only *where files live* changed. Firestore still
// stores the resulting download URLs exactly as before (images[] / video).
//
// SETUP REQUIRED (one-time, ~2 minutes, no credit card):
// 1. Create a free account at https://cloudinary.com/users/register/free
// 2. In the Cloudinary console, copy your "Cloud name" (shown on the
//    dashboard home page) into CLOUDINARY_CLOUD_NAME below.
// 3. Go to Settings -> Upload -> Upload presets -> "Add upload preset".
//    Set "Signing Mode" to UNSIGNED, save, and copy its name into
//    CLOUDINARY_UPLOAD_PRESET below.
// That's it — no server code, no API secret needed for uploads.
// ============================================================================

// ---- Cloudinary account config — fill these in after setup above ---------
export const CLOUDINARY_CLOUD_NAME = "c5oiplym";
export const CLOUDINARY_UPLOAD_PRESET = "eomebqzl";

export const MAX_IMAGES_PER_POST = 10;
export const MAX_IMAGE_DIMENSION = 1600; // px, longest side after compression
export const IMAGE_JPEG_QUALITY_START = 0.88;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB ceiling per compressed image

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB
export const MAX_VIDEO_SECONDS = 120; // 2 minutes
export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const ACCEPTED_VIDEO_EXT = /\.(mp4|mov|webm)$/i;

// ----------------------------------------------------------------------------
// Image compression — resizes to MAX_IMAGE_DIMENSION and re-encodes as JPEG,
// stepping quality down only if needed. Returns a Blob.
// ----------------------------------------------------------------------------
export function compressImageFile(file, maxDimension = MAX_IMAGE_DIMENSION) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDimension) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else if (height >= width && height > maxDimension) {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);

      const tryEncode = (quality) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Could not process that image."));
              return;
            }
            if (blob.size > MAX_IMAGE_BYTES && quality > 0.35) {
              tryEncode(quality - 0.12);
              return;
            }
            resolve(blob);
          },
          "image/jpeg",
          quality
        );
      };
      tryEncode(IMAGE_JPEG_QUALITY_START);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image file. Please try a different photo."));
    };
    img.src = objectUrl;
  });
}

// ----------------------------------------------------------------------------
// Video validation — checks type/extension, size, and (by loading metadata)
// duration, before anything is uploaded.
// ----------------------------------------------------------------------------
export function readVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const objectUrl = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(video.duration || 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that video file. Please try a different file."));
    };
    video.src = objectUrl;
  });
}

export async function validateVideoFile(file) {
  const typeOk = ACCEPTED_VIDEO_TYPES.includes(file.type) || ACCEPTED_VIDEO_EXT.test(file.name || "");
  if (!typeOk) {
    throw new Error("Videos must be MP4, MOV, or WEBM.");
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(`Video is too large — max size is ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))}MB.`);
  }
  const duration = await readVideoDuration(file);
  if (duration > MAX_VIDEO_SECONDS + 0.5) {
    throw new Error(`Video is too long — max duration is ${MAX_VIDEO_SECONDS} seconds.`);
  }
  return duration;
}

// ----------------------------------------------------------------------------
// Cloudinary upload/delete
// ----------------------------------------------------------------------------

function assertCloudinaryConfigured() {
  if (CLOUDINARY_CLOUD_NAME === "YOUR_CLOUD_NAME" || CLOUDINARY_UPLOAD_PRESET === "YOUR_UNSIGNED_PRESET") {
    throw new Error(
      "Media upload isn't set up yet — add your Cloudinary cloud name and upload preset in js/media-upload.js."
    );
  }
}

// Uploads a Blob/File to Cloudinary, reporting 0-100 progress via
// onProgress. Uses XHR (not fetch) specifically because fetch has no
// built-in upload-progress event.
export function uploadFileWithProgress(path, blob, onProgress, resourceType = "auto") {
  return new Promise((resolve, reject) => {
    assertCloudinaryConfigured();

    const formData = new FormData();
    formData.append("file", blob);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    // `path` (e.g. "announcement-media/{uid}/{postId}/img-...") becomes the
    // Cloudinary public_id, so files stay organized per-post just like the
    // Storage version did, and are easy to find/manage in the Cloudinary
    // console's Media Library.
    formData.append("public_id", path);

    const xhr = new XMLHttpRequest();
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
    xhr.open("POST", url, true);

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && res.secure_url) {
          resolve(res.secure_url);
        } else {
          reject(new Error(res?.error?.message || "Upload failed. Please try again."));
        }
      } catch (err) {
        reject(new Error("Upload failed — unexpected response. Please try again."));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection and try again."));
    xhr.send(formData);
  });
}

// Best-effort cleanup placeholder. Cloudinary's unsigned uploads (client-side,
// no API secret) can't delete files directly for security reasons — actual
// deletion requires a signed request from a server, which this project
// doesn't have. Orphaned files just sit in the free tier's spare capacity;
// this is intentionally a no-op so the rest of the app (delete post, remove
// image in edit mode, etc.) keeps working exactly as before without erroring.
// If you add a small backend later, swap this for a real Cloudinary Admin
// API delete call and it'll slot right in.
export async function deleteFileByURL(url) {
  return;
}

// Builds an organized, reasonably-unique path/public_id for a piece of post
// media (mirrors the old Storage path layout).
export function postMediaPath(uid, postId, kind, index, ext) {
  const rand = Math.random().toString(36).slice(2, 8);
  const stamp = Date.now();
  return `announcement-media/${uid}/${postId}/${kind}-${stamp}-${index}-${rand}`;
}
