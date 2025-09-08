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
    
    console.log(`🔍 Comprehensive scraping analysis for: ${boardUrl}`);
    
    const results = {
      success: true,
      totalStrategies: 0,
      strategies: [] as any[],
      bestResult: null as any,
      summary: {
        maxPins: 0,
        bestStrategy: '',
        allPins: [] as PinterestImage[],
        duplicateAnalysis: {
          totalUnique: 0,
          crossStrategyDuplicates: 0
        }
      }
    };
    
    const allSeenPins = new Map<string, PinterestImage>();
    const strategyResults: any[] = [];
    
    // Strategy 1: Current Enhanced Scraping
    try {
      console.log('📋 Strategy 1: Current Enhanced Scraping');
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
        const html = await response.text();
        const { images, debugInfo } = extractImagesFromHtml(html);
        
        const strategyResult = {
          name: 'Current Enhanced Scraping',
          success: true,
          pinCount: images.length,
          images,
          debugInfo,
          uniqueToStrategy: 0
        };
        
        // Track unique pins
        let uniqueCount = 0;
        for (const image of images) {
          if (!allSeenPins.has(image.id)) {
            allSeenPins.set(image.id, image);
            uniqueCount++;
          }
        }
        strategyResult.uniqueToStrategy = uniqueCount;
        strategyResults.push(strategyResult);
        
        console.log(`✅ Strategy 1: ${images.length} pins, ${uniqueCount} unique`);
      } else {
        console.log(`❌ Strategy 1 failed: ${response.status}`);
        strategyResults.push({
          name: 'Current Enhanced Scraping',
          success: false,
          error: `HTTP ${response.status}`,
          pinCount: 0,
          images: []
        });
      }
    } catch (error) {
      console.log('❌ Strategy 1 error:', error);
      strategyResults.push({
        name: 'Current Enhanced Scraping',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        pinCount: 0,
        images: []
      });
    }
    
    // Strategy 2: RSS Feed Attempt
    try {
      console.log('📋 Strategy 2: RSS Feed');
      const rssUrl = boardUrl.replace(/\/$/, '') + '.rss';
      const response = await fetch(rssUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader)',
          'Accept': 'application/rss+xml, application/xml, text/xml',
        }
      });
      
      let strategyResult;
      if (response.ok) {
        const rssContent = await response.text();
        console.log(`RSS response length: ${rssContent.length}`);
        
        // Parse RSS for image URLs (basic implementation)
        const imageUrls: string[] = [];
        const urlMatches = rssContent.match(/https:\/\/i\.pinimg\.com\/[^"'\s>]+/g);
        if (urlMatches) {
          imageUrls.push(...urlMatches);
        }
        
        const rssImages: PinterestImage[] = [];
        const seenUrls = new Set<string>();
        
        for (const url of imageUrls) {
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            const id = url.split('/').pop()?.split('.')[0] || Math.random().toString();
            rssImages.push({
              id,
              thumbnail: url,
              medium: url,
              original: url,
              title: 'RSS Pin',
              url: boardUrl,
              boardName: 'moodboard'
            });
          }
        }
        
        strategyResult = {
          name: 'RSS Feed',
          success: true,
          pinCount: rssImages.length,
          images: rssImages,
          uniqueToStrategy: 0,
          rssLength: rssContent.length,
          hasRssContent: rssContent.includes('<rss') || rssContent.includes('<feed')
        };
        
        // Track unique pins
        let uniqueCount = 0;
        for (const image of rssImages) {
          if (!allSeenPins.has(image.id)) {
            allSeenPins.set(image.id, image);
            uniqueCount++;
          }
        }
        strategyResult.uniqueToStrategy = uniqueCount;
        
        console.log(`✅ Strategy 2: ${rssImages.length} pins from RSS, ${uniqueCount} unique`);
      } else {
        console.log(`❌ Strategy 2 failed: ${response.status}`);
        strategyResult = {
          name: 'RSS Feed',
          success: false,
          error: `HTTP ${response.status}`,
          pinCount: 0,
          images: []
        };
      }
      strategyResults.push(strategyResult);
    } catch (error) {
      console.log('❌ Strategy 2 error:', error);
      strategyResults.push({
        name: 'RSS Feed',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        pinCount: 0,
        images: []
      });
    }
    
    // Strategy 3: Mobile Pinterest
    try {
      console.log('📋 Strategy 3: Mobile Pinterest');
      const mobileUrl = boardUrl.replace('www.pinterest.com', 'm.pinterest.com');
      const response = await fetch(mobileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });
      
      if (response.ok) {
        const html = await response.text();
        const { images } = extractImagesFromHtml(html);
        
        const strategyResult = {
          name: 'Mobile Pinterest',
          success: true,
          pinCount: images.length,
          images,
          uniqueToStrategy: 0
        };
        
        // Track unique pins
        let uniqueCount = 0;
        for (const image of images) {
          if (!allSeenPins.has(image.id)) {
            allSeenPins.set(image.id, image);
            uniqueCount++;
          }
        }
        strategyResult.uniqueToStrategy = uniqueCount;
        strategyResults.push(strategyResult);
        
        console.log(`✅ Strategy 3: ${images.length} pins, ${uniqueCount} unique`);
      } else {
        console.log(`❌ Strategy 3 failed: ${response.status}`);
        strategyResults.push({
          name: 'Mobile Pinterest',
          success: false,
          error: `HTTP ${response.status}`,
          pinCount: 0,
          images: []
        });
      }
    } catch (error) {
      console.log('❌ Strategy 3 error:', error);
      strategyResults.push({
        name: 'Mobile Pinterest',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        pinCount: 0,
        images: []
      });
    }
    
    // Strategy 4: Alternative URL Formats
    try {
      console.log('📋 Strategy 4: Alternative URL Formats');
      const altUrls = [
        boardUrl + '?page_size=250',
        boardUrl + '?limit=100',
        boardUrl + 'pins/',
        boardUrl.replace('pinterest.com', 'pinterest.com') + '?show=all'
      ];
      
      let bestAltResult = { pinCount: 0, images: [], url: '', uniqueToStrategy: 0 };
      
      for (const altUrl of altUrls) {
        try {
          const response = await fetch(altUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            }
          });
          
          if (response.ok) {
            const html = await response.text();
            const { images } = extractImagesFromHtml(html);
            
            if (images.length > bestAltResult.pinCount) {
              // Track unique pins for this URL
              let uniqueCount = 0;
              for (const image of images) {
                if (!allSeenPins.has(image.id)) {
                  uniqueCount++;
                }
              }
              
              bestAltResult = {
                pinCount: images.length,
                images,
                url: altUrl,
                uniqueToStrategy: uniqueCount
              };
            }
            
            console.log(`Alternative URL ${altUrl}: ${images.length} pins`);
          }
          
          // Small delay between requests
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (urlError) {
          console.log(`Alt URL ${altUrl} failed:`, urlError);
        }
      }
      
      // Add unique pins to global set
      for (const image of bestAltResult.images) {
        if (!allSeenPins.has(image.id)) {
          allSeenPins.set(image.id, image);
        }
      }
      
      strategyResults.push({
        name: 'Alternative URL Formats',
        success: bestAltResult.pinCount > 0,
        pinCount: bestAltResult.pinCount,
        images: bestAltResult.images,
        bestUrl: bestAltResult.url,
        uniqueToStrategy: bestAltResult.uniqueToStrategy
      });
      
      console.log(`✅ Strategy 4: ${bestAltResult.pinCount} pins, ${bestAltResult.uniqueToStrategy} unique`);
    } catch (error) {
      console.log('❌ Strategy 4 error:', error);
      strategyResults.push({
        name: 'Alternative URL Formats',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        pinCount: 0,
        images: []
      });
    }
    
    // Find best result and compile summary
    let bestStrategy = strategyResults[0];
    for (const strategy of strategyResults) {
      if (strategy.success && strategy.pinCount > (bestStrategy?.pinCount || 0)) {
        bestStrategy = strategy;
      }
    }
    
    results.strategies = strategyResults;
    results.totalStrategies = strategyResults.length;
    results.bestResult = bestStrategy;
    results.summary = {
      maxPins: bestStrategy?.pinCount || 0,
      bestStrategy: bestStrategy?.name || 'None',
      allPins: Array.from(allSeenPins.values()),
      duplicateAnalysis: {
        totalUnique: allSeenPins.size,
        crossStrategyDuplicates: strategyResults.reduce((sum, s) => sum + (s.pinCount || 0), 0) - allSeenPins.size
      }
    };
    
    console.log(`🎯 Comprehensive scraping complete:`);
    console.log(`   Best strategy: ${results.summary.bestStrategy} (${results.summary.maxPins} pins)`);
    console.log(`   Total unique pins across all strategies: ${results.summary.duplicateAnalysis.totalUnique}`);
    console.log(`   Target: 82 pins`);
    console.log(`   Gap: ${82 - results.summary.duplicateAnalysis.totalUnique} pins`);
    
    return NextResponse.json(results);
    
  } catch (error) {
    console.error('Comprehensive scraping error:', error);
    return NextResponse.json(
      { 
        error: 'Comprehensive scraping failed', 
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}