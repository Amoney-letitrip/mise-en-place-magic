import { supabase } from '@/integrations/supabase/client';

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SUPPORTED_PDF_TYPE = 'application/pdf';
const MAX_IMAGE_EDGE = 1800;
const JPEG_QUALITY = 0.84;
const MAX_PDF_SIZE_MB = 10;

export const MENU_UPLOAD_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf';

const fileToBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read that file. Try another image or PDF.'));
    reader.readAsDataURL(file);
  });

const imageToJpegBlob = async (file: File): Promise<Blob> => {
  const sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('That image format is not supported. Use JPG, PNG, WebP, or PDF.'));
      image.src = sourceUrl;
    });

    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare that image. Try a different file.');
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });
    if (!blob) throw new Error('Could not compress that image. Try a smaller JPG or PNG.');
    return blob;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
};

export const prepareMenuUpload = async (file: File): Promise<{ base64: string; mediaType: string }> => {
  if (file.type === SUPPORTED_PDF_TYPE || file.name.toLowerCase().endsWith('.pdf')) {
    if (file.size > MAX_PDF_SIZE_MB * 1024 * 1024) {
      throw new Error(`PDF is over ${MAX_PDF_SIZE_MB}MB. Export a smaller PDF or upload a menu photo.`);
    }
    return { base64: await fileToBase64(file), mediaType: SUPPORTED_PDF_TYPE };
  }

  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('That image format is not supported. Use JPG, PNG, WebP, or PDF.');
  }

  const jpeg = await imageToJpegBlob(file);
  return { base64: await fileToBase64(jpeg), mediaType: 'image/jpeg' };
};

export const getScanErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '');
    if (message) return message;
  }
  return 'Scan failed. Try a clearer JPG, PNG, WebP, or PDF.';
};

export const invokeScanMenu = async (body: { type: 'photo'; base64: string; mediaType: string } | { type: 'url'; url: string }) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();
  const authHeader = session?.access_token ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`;

  const response = await fetch(`${supabaseUrl}/functions/v1/scan-menu`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
      'apikey': anonKey,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Menu scan failed with HTTP ${response.status}`);
  }
  return payload as { recipes?: Array<{ name: string; menu_price?: number; ingredients: Array<{ name: string; qty: number; unit: string }> }> };
};
