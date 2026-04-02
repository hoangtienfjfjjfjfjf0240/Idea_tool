import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const thumbBase64 = formData.get('thumbBase64') as string | null;

    const supabase = createServerClient();
    let videoUrl: string | null = null;
    let imageUrl: string | null = null;

    // Upload main file (video or image)
    if (file) {
      const ext = file.name.split('.').pop() || 'bin';
      const path = `hooks/${crypto.randomUUID()}_${Date.now()}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      const { error } = await supabase.storage
        .from('hook-media')
        .upload(path, buffer, { 
          contentType: file.type, 
          cacheControl: '3600', 
          upsert: false 
        });

      if (error) {
        console.error('[upload-hook-media] File upload error:', error.message);
        return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
      }

      const { data: urlData } = supabase.storage.from('hook-media').getPublicUrl(path);
      const publicUrl = urlData?.publicUrl || null;

      if (file.type.startsWith('video')) {
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
