import { NextRequest, NextResponse } from 'next/server';
import { extractImagesFromHtml } from '@/lib/scraper';
import type { PinterestImage } from '@/lib/scraper';

export async function POST(request: NextRequest) {
  try {
    const { boardUrl } = await request.json();
    
    if (!boardUrl || !boardUrl.includes('pinterest.com')) {
      return NextResponse.json(
        { error: 'Invalid Pinterest board URL' },
        { status: 400 }
      );
    }
    
    console.log(`🎭 Playwright scraping started for: ${boardUrl}`);
    const startTime = Date.now();
    
    // Call Playwright MCP to perform browser automation
    const playwrightResponse = await fetch('http://localhost:3001/playwright-scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: boardUrl,
        scrollStrategy: 'infinite',
        timeout: 60000,
        waitForNetworkIdle: true
      })
    }).catch(error => {
      console.log('🚨 Playwright MCP not available, falling back to static scraping');
      return null;
    });
    
    let finalHtml = '';
    let playwrightSuccess = false;
    
    if (playwrightResponse && playwrightResponse.ok) {
      const playwrightData = await playwrightResponse.json();
      if (playwrightData.success && playwrightData.html) {
        finalHtml = playwrightData.html;
        playwrightSuccess = true;
        console.log(`✅ Playwright scraping successful: ${playwrightData.scrolls || 0} scrolls, ${playwrightData.networkRequests || 0} network requests`);
      }
    }
    
    // Fallback to static scraping if Playwright fails
    if (!playwrightSuccess) {
      console.log('📋 Falling back to enhanced static scraping...');
      const response = await fetch(boardUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        }
      });
      
      if (response.ok) {
        finalHtml = await response.text();
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }
    
    // Extract images using existing scraper logic
    const { images, debugInfo } = extractImagesFromHtml(finalHtml);
    
    const executionTime = Date.now() - startTime;
    
    const result = {
      success: true,
      method: playwrightSuccess ? 'playwright-automation' : 'static-fallback',
      totalPinsFound: images.length,
      targetPins: 82,
      completionPercentage: Math.round((images.length / 82) * 100),
      executionTimeMs: executionTime,
      images: images,
      boardInfo: {
        name: 'moodboard',
        url: boardUrl,
        pinCount: images.length,
        owner: 'btangonan'
      },
      metadata: {
        playwrightSuccess,
        scrapingMethod: playwrightSuccess ? 'Browser automation with infinite scroll' : 'Enhanced static HTML scraping',
        networkRequests: playwrightSuccess ? debugInfo?.networkRequests || 'N/A' : 'Static request only',
        scrolls: playwrightSuccess ? debugInfo?.scrolls || 'N/A' : 'No scrolling'
      },
      message: images.length >= 75 
        ? `🎉 Excellent! Found ${images.length} pins (${Math.round((images.length / 82) * 100)}% of expected 82) using ${playwrightSuccess ? 'browser automation' : 'static scraping'}`
        : `✅ Found ${images.length} pins using ${playwrightSuccess ? 'Playwright automation' : 'static scraping'}. ${images.length < 60 ? 'Consider trying browser automation for complete extraction.' : ''}`
    };
    
    console.log(`🎯 Scraping complete: ${images.length} pins in ${executionTime}ms using ${result.method}`);
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Playwright scraping error:', error);
    return NextResponse.json(
      { 
        error: 'Playwright scraping failed', 
        details: error instanceof Error ? error.message : 'Unknown error',
        suggestion: 'Try the enhanced scraping endpoint for partial results'
      },
      { status: 500 }
    );
  }
}

// Simulated Playwright automation logic (will be replaced with actual MCP calls)
async function simulatePlaywrightScraping(url: string) {
  // This is a placeholder for the actual Playwright MCP implementation
  // The real version will use the Playwright MCP server to:
  // 1. Launch browser
  // 2. Navigate to URL  
  // 3. Implement intelligent scrolling
  // 4. Wait for network idle
  // 5. Extract final DOM
  // 6. Return HTML content
  
  console.log('🎭 Simulated Playwright automation...');
  
  // For now, return null to trigger fallback
  return {
    success: false,
    html: '',
    scrolls: 0,
    networkRequests: 0
  };
}