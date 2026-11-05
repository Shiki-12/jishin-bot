/**
 * Logika inti untuk fitur Vision (F-30: Baca Gambar).
 * Menangani pemilihan resolusi foto, unduhan & konversi base64, serta format pesan OpenAI vision.
 */

export const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // 20 MB (batas Telegram Bot API)
export const MAX_PHOTO_DIMENSION = 4096;

/**
 * Memilih ukuran foto terbaik dari array PhotoSize Telegram.
 * Mengambil ukuran terbesar yang masih di bawah batas wajar (maxBytes & maxDimension).
 *
 * @param {Array<{ file_id: string, width: number, height: number, file_size?: number }>} photos
 * @param {{ maxBytes?: number, maxDimension?: number }} [options]
 * @returns {object|null}
 */
export function selectBestPhoto(photos, { maxBytes = MAX_PHOTO_BYTES, maxDimension = MAX_PHOTO_DIMENSION } = {}) {
  if (!Array.isArray(photos) || photos.length === 0) return null;

  // Filter foto yang memenuhi batas ukuran dan resolusi
  const valid = photos.filter((p) => {
    if (!p || !p.file_id) return false;
    const sizeOk = p.file_size == null || p.file_size <= maxBytes;
    const dimOk =
      (p.width == null || p.width <= maxDimension) &&
      (p.height == null || p.height <= maxDimension);
    return sizeOk && dimOk;
  });

  if (valid.length === 0) return null;

  // Urutkan dari yang terbesar (resolusi pixel atau file_size)
  return valid.slice().sort((a, b) => {
    const areaA = (a.width || 0) * (a.height || 0);
    const areaB = (b.width || 0) * (b.height || 0);
    if (areaA !== areaB) return areaB - areaA;
    return (b.file_size || 0) - (a.file_size || 0);
  })[0];
}

/**
 * Format teks placeholder untuk riwayat pesan agar foto base64 tidak disimpan di database.
 *
 * @param {string} [caption]
 * @returns {string}
 */
export function buildPhotoPlaceholder(caption) {
  const clean = (caption || '').trim();
  return clean ? `[user mengirim foto: ${clean}]` : '[user mengirim foto]';
}

/**
 * Deteksi ekstensi file dan kembalikan MIME type gambar yang sesuai.
 *
 * @param {string} filePath
 * @returns {string}
 */
export function getMimeTypeFromPath(filePath = '') {
  if (/\.png$/i.test(filePath)) return 'image/png';
  if (/\.webp$/i.test(filePath)) return 'image/webp';
  if (/\.gif$/i.test(filePath)) return 'image/gif';
  return 'image/jpeg';
}

/**
 * Mengunduh file foto dari server Telegram dan mengonversinya menjadi base64 Data URL.
 *
 * @param {object} args
 * @param {object} args.api Instance Telegram API (ctx.api atau bot.api)
 * @param {string} args.fileId ID file Telegram
 * @param {string} [args.botToken] Token bot Telegram
 * @param {Function} [args.fetchFn] Fungsi fetch (default: global fetch)
 * @param {number} [args.maxBytes] Batas maksimal ukuran byte
 * @returns {Promise<string>} Data URL base64 (contoh: "data:image/jpeg;base64,...")
 */
export async function downloadPhotoAsBase64({
  api,
  fileId,
  botToken = process.env.TELEGRAM_BOT_TOKEN,
  fetchFn = fetch,
  maxBytes = MAX_PHOTO_BYTES,
}) {
  if (!fileId) {
    throw new Error('fileId wajib disediakan.');
  }

  if (!api || typeof api.getFile !== 'function') {
    throw new Error('Instance api dengan method getFile wajib disediakan.');
  }

  const fileInfo = await api.getFile(fileId);
  if (!fileInfo?.file_path) {
    throw new Error('Telegram tidak mengembalikan file_path untuk file tersebut.');
  }

  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN tidak ditemukan.');
  }

  const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
  const response = await fetchFn(downloadUrl);

  if (!response.ok) {
    throw new Error(`Gagal mengunduh foto dari Telegram: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error(`Ukuran foto (${arrayBuffer.byteLength} byte) melebihi batas maksimal ${maxBytes} byte.`);
  }

  const buffer = Buffer.from(arrayBuffer);
  const base64Data = buffer.toString('base64');
  const mimeType = getMimeTypeFromPath(fileInfo.file_path);

  return `data:${mimeType};base64,${base64Data}`;
}

/**
 * Menyusun konten user multimodal dalam format OpenAI vision.
 *
 * @param {string} [caption]
 * @param {string} imageDataUrl
 * @returns {Array<object>}
 */
export function formatVisionUserContent(caption, imageDataUrl) {
  const promptText = (caption || '').trim() || 'Foto apa ini? Tolong jelaskan.';
  return [
    {
      type: 'text',
      text: promptText,
    },
    {
      type: 'image_url',
      image_url: {
        url: imageDataUrl,
      },
    },
  ];
}
