import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const imageUrl = searchParams.get('url');
  
  if (!imageUrl) {
    return NextResponse.json({ error: 'Image URL required' }, { status: 400 });
  }
  
  try {
    // Fetch image from Pinterest CDN (server-side, no CORS)
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    });
    
    if (!response.ok) {
      console.error(`Image fetch failed: ${response.status} ${response.statusText} for ${imageUrl}`);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    
    // Return image with proper headers
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      }
    });
    
  } catch (error) {
    console.error('Download proxy error:', error);
    return NextResponse.json({ error: 'Failed to download image' }, { status: 500 });
  }
}