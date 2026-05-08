import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import {
  guardApiRequest,
  HOOK_MEDIA_MIME_TYPES,
  maxThumbBytes,
  maxUploadBytes,
} from '@/lib/apiGuards';

const EXTRA_HOOK_MEDIA_MIME_TYPES = [
  'video/x-m4v',
  'video/mov',
  'video/avi',
  'video/x-msvideo',
  'video/x-ms-wmv',
  'image/gif',
];

function inferMimeTypeFromName(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    avi: 'video/x-msvideo',
    wmv: 'video/x-ms-wmv',
    mpeg: 'video/mpeg',
    mpg: 'video/mpeg',
  };
  return map[ext] || '';
}

function normalizeUploadMimeType(file: File) {
  return file.type || inferMimeTypeFromName(file.name);
}

function isAllowedMediaMimeType(mimeType: string) {
  return HOOK_MEDIA_MIME_TYPES.includes(mimeType) || EXTRA_HOOK_MEDIA_MIME_TYPES.includes(mimeType);
}

export async function POST(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'upload-hook-media', max: 20, windowMs: 10 * 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const thumbBase64 = formData.get('thumbBase64') as string | null;

    const supabase = createServerClient();
    let videoUrl: string | null = null;
    let imageUrl: string | null = null;

    // Upload main file (video or image)
    if (file) {
      if (file.size > maxUploadBytes()) {
        return NextResponse.json({ error: 'File quá lớn để upload.' }, { status: 413 });
      }
      const mimeType = normalizeUploadMimeType(file);
      if (!isAllowedMediaMimeType(mimeType)) {
        return NextResponse.json({ error: `Định dạng file không được hỗ trợ (${file.type || 'unknown'}).` }, { status: 415 });
      }

      const ext = file.name.split('.').pop() || 'bin';
      const path = `hooks/${crypto.randomUUID()}_${Date.now()}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      const { error } = await supabase.storage
        .from('hook-media')
        .upload(path, buffer, { 
          contentType: mimeType,
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('[upload-hook-media] File upload error:', error.message);
        return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
      }

      const { data: urlData } = supabase.storage.from('hook-media').getPublicUrl(path);
      const publicUrl = urlData?.publicUrl || null;

      if (mimeType.startsWith('video/')) {
        videoUrl = publicUrl;
      } else {
        imageUrl = publicUrl;
      }
    }

    // Upload thumbnail if provided (base64 string of video first frame)
    if (thumbBase64) {
      const match = thumbBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const rawData = match[2];
        if (!isAllowedMediaMimeType(mimeType)) {
          return NextResponse.json({ error: 'Định dạng thumbnail không được hỗ trợ.' }, { status: 415 });
        }
        if (Buffer.byteLength(rawData, 'base64') > maxThumbBytes()) {
          return NextResponse.json({ error: 'Thumbnail quá lớn để upload.' }, { status: 413 });
        }
        const byteChars = atob(rawData);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);

        const ext = mimeType.split('/')[1] || 'jpg';
        const thumbPath = `hooks/thumb_${Date.now()}.${ext}`;

        const { error: thumbError } = await supabase.storage
          .from('hook-media')
          .upload(thumbPath, byteArray, { 
            contentType: mimeType,
            cacheControl: '3600',
            upsert: false
          });

        if (!thumbError) {
          const { data: thumbUrlData } = supabase.storage.from('hook-media').getPublicUrl(thumbPath);
          imageUrl = thumbUrlData?.publicUrl || null;
        } else {
          console.error('[upload-hook-media] Thumb upload error:', thumbError.message);
        }
      }
    }

    return NextResponse.json({ success: true, videoUrl, imageUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[upload-hook-media] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
