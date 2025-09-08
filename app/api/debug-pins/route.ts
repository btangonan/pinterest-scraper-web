import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { boardUrl } = await request.json();
    
    if (!boardUrl || !boardUrl.includes('pinterest.com')) {
      return NextResponse.json(
        { error: 'Invalid Pinterest board URL' },
        { status: 400 }
      );
    }
    
    console.log(`Debug analysis for: ${boardUrl}`);
    
    // Fetch the Pinterest board page
    const response = await fetch(boardUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch board: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Debug: Analyze all Pinterest image URLs and their context
    const debugInfo = {
      totalHtmlSize: html.length,
      imageAnalysis: [] as any[]
    };
    
    // Extract all Pinterest image URLs with context
    const imgPatterns = [
      /"(https:\/\/i\.pinimg\.com\/[^"]+)"/g,
      /src="(https:\/\/i\.pinimg\.com\/[^"]+)"/g,
      /data-src="(https:\/\/i\.pinimg\.com\/[^"]+)"/g
    ];
    
    const foundImages = new Map<string, any>();
    
    for (const pattern of imgPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const imageUrl = match[1];
        const startIndex = match.index;
        
        // Extract surrounding context (500 chars before and after)
        const contextStart = Math.max(0, startIndex - 500);
        const contextEnd = Math.min(html.length, startIndex + 500);
        const context = html.slice(contextStart, contextEnd);
        
        // Extract dimensions and image info
        const dimensionMatch = imageUrl.match(/\/(\d+x|\w+)\//);
        const dimension = dimensionMatch?.[1] || 'unknown';
        const imagePath = imageUrl.split('/').slice(-1)[0];
        const imageHash = imagePath.split('.')[0];
        
        // Check for non-pin indicators in context
        const nonPinIndicators = {
          isAd: context.includes('promoted') || context.includes('advertisement'),
          isProfile: imageUrl.includes('/user/') || imageUrl.includes('/avatars/'),
          isStatic: imageUrl.includes('/static/') || imageUrl.includes('/boards/'),
          isShopping: context.includes('shopping') || context.includes('product'),
          isRelated: context.includes('related') || context.includes('more like this'),
          isSuggestion: context.includes('suggestion') || context.includes('recommended'),
          contextHints: [
            context.includes('data-test-id="pin"') ? 'actual-pin' : null,
            context.includes('closeup') ? 'closeup-view' : null,
            context.includes('board') ? 'board-context' : null,
            context.includes('profile') ? 'profile-context' : null
          ].filter(Boolean)
        };
        
        if (!foundImages.has(imageHash)) {
          foundImages.set(imageHash, {
            imageUrl,
            imageHash,
            dimension,
            imagePath,
            nonPinIndicators,
            contextSample: context.substring(Math.max(0, 250-50), 250+50), // 100 chars around the image
            occurrenceCount: 1
          });
        } else {
          foundImages.get(imageHash)!.occurrenceCount++;
        }
      }
    }
    
    debugInfo.imageAnalysis = Array.from(foundImages.values());
    
    // Additional analysis: Look for pagination tokens
    const paginationTokens = {
      bookmarks: html.match(/"bookmarks":\s*\["([^"]+)"/)?.[1],
      hasMore: html.includes('"has_more":true'),
      boardFeedData: !!html.match(/"BoardFeedResource"/),
      csrfToken: html.match(/"csrfToken":\s*"([^"]+)"/)?.[1]
    };
    
    debugInfo.paginationTokens = paginationTokens;
    
    // Summary stats
    debugInfo.summary = {
      totalUniqueImages: foundImages.size,
      probableActualPins: Array.from(foundImages.values()).filter(img => 
        !img.nonPinIndicators.isAd && 
        !img.nonPinIndicators.isProfile && 
        !img.nonPinIndicators.isStatic &&
        img.nonPinIndicators.contextHints.includes('actual-pin')
      ).length,
      probableNonPins: Array.from(foundImages.values()).filter(img => 
        img.nonPinIndicators.isAd || 
        img.nonPinIndicators.isProfile || 
        img.nonPinIndicators.isStatic ||
        img.nonPinIndicators.isShopping ||
        img.nonPinIndicators.isRelated
      ).length
    };
    
    return NextResponse.json(debugInfo);
    
  } catch (error) {
    console.error('Debug analysis error:', error);
    return NextResponse.json(
      { error: 'Debug analysis failed', details: error.message },
      { status: 500 }
    );
  }
}