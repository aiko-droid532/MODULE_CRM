import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ success: false, error: 'Файл не найден' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    const ext = path.extname(file.name) || '.png';
    const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;

    // 1. Попытка загрузить в бакет Supabase Storage (layouts)
    if (supabase) {
      try {
        const { data, error } = await supabase.storage
          .from('LAYOUTS')
          .upload(filename, buffer, {
            contentType: file.type || 'image/png',
            upsert: true
          });

        if (!error && data) {
          const { data: publicUrlData } = supabase.storage
            .from('LAYOUTS')
            .getPublicUrl(filename);
            
          if (publicUrlData?.publicUrl) {
            return NextResponse.json({ success: true, url: publicUrlData.publicUrl });
          }
        } else {
          console.warn('Supabase upload warning, falling back to local:', error?.message);
        }
      } catch (uploadError: any) {
        console.error('Supabase upload exception, falling back to local:', uploadError.message);
      }
    }

    // 2. Фолбэк: Сохранение локально в public/uploads
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, buffer);

    const fileUrl = `/uploads/${filename}`;
    return NextResponse.json({ success: true, url: fileUrl });

  } catch (error: any) {
    console.error('Upload route error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
