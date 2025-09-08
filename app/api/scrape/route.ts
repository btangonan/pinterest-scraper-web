import { NextRequest, NextResponse } from 'next/server';
import { scrapePinterestBoard } from '@/lib/scraper';

export async function POST(request: NextRequest) {
  try {
    const { boardUrl, maxPages = 20 } = await request.json();
    
    if (!boardUrl || !boardUrl.includes('pinterest.com')) {
      return NextResponse.json(
        { error: 'Invalid Pinterest board URL' },
        { status: 400 }
      );
    }
    
    console.log(`Fetching board: ${boardUrl}`);
    console.log(`Max pages to fetch: ${maxPages}`);
    
    // Scrape the board with pagination
    const { images, boardInfo } = await scrapePinterestBoard(boardUrl, maxPages);
    
    console.log(`Scraped ${images.length} images from board: ${boardInfo?.name || 'unknown'}`);
    if (boardInfo?.pinCount) {
      console.log(`Board has ${boardInfo.pinCount} total pins, fetched ${images.length}`);
    }
    
    if (images.length === 0) {
      return NextResponse.json(
        { error: 'No images found on this board. Make sure it\'s a public board.' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ 
      images,
      count: images.length,
      boardUrl,
      boardInfo,
      message: boardInfo?.pinCount && boardInfo.pinCount > images.length 
        ? `Fetched ${images.length} of ${boardInfo.pinCount} pins. Some pins may be private or unavailable.`
        : `Successfully fetched all ${images.length} pins from the board!`
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    return NextResponse.json(
      { error: 'Failed to scrape Pinterest board' },
      { status: 500 }
    );
  }
}