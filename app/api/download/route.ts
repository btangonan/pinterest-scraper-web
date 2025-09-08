import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const imageUrl = searchParams.get('url');
  const fileParam = searchParams.get('filename') || undefined;

  if (!imageUrl) {
    return NextResponse.json({ error: 'Image URL required' }, { status: 400 });
  }

  // Basic validation to ensure we're proxying only http(s) URLs
  try {
    const parsed = new URL(imageUrl);
    if (!/^https?:$/.test(parsed.protocol)) {
      return NextResponse.json({ error: 'Invalid URL protocol' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Malformed image URL' }, { status: 400 });
  }

  // imageUrl is guaranteed non-null beyond this point
  const targetUrl = imageUrl as string;

  const UA_DESKTOP =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36';
  const UA_MOBILE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  async function attemptFetch(ua: string) {
    return fetch(targetUrl, {
      headers: {
        'User-Agent': ua,
        'Referer': 'https://www.pinterest.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Connection': 'keep-alive'
      }
    });
  }

  try {
    // Try desktop-like headers first
    let response = await attemptFetch(UA_DESKTOP);

    // If blocked by CDN (403/429) or other non-OK, retry once with mobile UA
    if (!response.ok && (response.status === 403 || response.status === 429)) {
      await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 500)));
      response = await attemptFetch(UA_MOBILE);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`Image fetch failed (${response.status} ${response.statusText}) for ${imageUrl} :: ${text.slice(0, 200)}`);
      return NextResponse.json(
        { error: `Image fetch failed: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    // Derive filename
    let filename = fileParam;
    if (!filename) {
      try {
        const urlObj = new URL(targetUrl);
        const last = urlObj.pathname.split('/').filter(Boolean).pop() || 'image';
        filename = last.includes('.') ? last : `${last}.${contentType.split('/')[1] || 'jpg'}`;
      } catch {
        filename = `image.${contentType.split('/')[1] || 'jpg'}`;
      }
    }

    // Return image with proper headers; allow caching for 1 hour
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        // Expose useful headers for browsers if needed
        'Content-Disposition': `inline; filename="${filename}"`,
      }
    });
  } catch (error) {
    console.error('Download proxy error:', error);
    return NextResponse.json({ error: 'Failed to download image' }, { status: 500 });
  }
}