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

type SignedUploadRequestBody = {
  action?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  kind?: 'file' | 'thumb';
};

function extensionFromMimeType(mimeType: string) {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-m4v': 'm4v',
    'video/mov': 'mov',
    'video/avi': 'avi',
    'video/x-msvideo': 'avi',
    'video/x-ms-wmv': 'wmv',
    'video/mpeg': 'mpeg',
  };
  return map[mimeType] || 'bin';
}

function safeUploadExtension(fileName: string | undefined, mimeType: string) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
  return ext || extensionFromMimeType(mimeType);
}

async function createSignedUploadResponse(body: SignedUploadRequestBody) {
  const fileName = typeof body.fileName === 'string' ? body.fileName : '';
  const mimeType = (typeof body.mimeType === 'string' ? body.mimeType : inferMimeTypeFromName(fileName)).trim();
  const size = Number(body.size);
  const kind = body.kind === 'thumb' ? 'thumb' : 'file';

  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: 'Thiếu dung lượng file upload.' }, { status: 400 });
  }
  if (!isAllowedMediaMimeType(mimeType)) {
    return NextResponse.json({ error: `Định dạng file không được hỗ trợ (${mimeType || 'unknown'}).` }, { status: 415 });
  }
  if (kind === 'thumb' && !mimeType.startsWith('image/')) {
    return NextResponse.json({ error: 'Thumbnail phải là định dạng ảnh.' }, { status: 415 });
  }

  const maxBytes = kind === 'thumb' ? maxThumbBytes() : maxUploadBytes();
  if (size > maxBytes) {
    return NextResponse.json({ error: kind === 'thumb' ? 'Thumbnail quá lớn để upload.' : 'File quá lớn để upload.' }, { status: 413 });
  }

  const supabase = createServerClient();
  const ext = safeUploadExtension(fileName, mimeType);
  const path = kind === 'thumb'
    ? `hooks/thumb_${crypto.randomUUID()}_${Date.now()}.${ext}`
    : `hooks/${crypto.randomUUID()}_${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage
    .from('hook-media')
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data?.token) {
    console.error('[upload-hook-media] Signed upload URL error:', error?.message || 'missing token');
    return NextResponse.json({ error: `Không tạo được upload URL: ${error?.message || 'missing token'}` }, { status: 500 });
  }

  const { data: urlData } = supabase.storage.from('hook-media').getPublicUrl(path);
  return NextResponse.json({
    success: true,
    path: data.path || path,
    token: data.token,
    signedUrl: data.signedUrl,
    publicUrl: urlData?.publicUrl || null,
  });
}

export async function POST(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'upload-hook-media', max: 20, windowMs: 10 * 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => null) as SignedUploadRequestBody | null;
      if (body?.action === 'create-signed-upload') {
        return createSignedUploadResponse(body);
      }
      return NextResponse.json({ error: 'Upload action không hợp lệ.' }, { status: 400 });
    }

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
