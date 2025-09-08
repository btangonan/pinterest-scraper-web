import { NextRequest, NextResponse } from 'next/server';
import { extractImagesFromHtml, transformImageUrl, parseBoardUrl } from '@/lib/scraper';
import type { PinterestImage } from '@/lib/scraper';

export const runtime = 'nodejs';

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
    
    // Use Playwright automation with DOM harvesting
    let finalHtml = '';
    let playwrightSuccess = false;
    let scrollCount = 0;
    let harvestedUrls: string[] = [];
    
    // Network pin collector via BoardFeedResource interception
    const networkPins = new Map<string, PinterestImage>();

    // Convert Pinterest pin JSON to PinterestImage
    const buildImageFromPin = (pin: any): PinterestImage | null => {
      if (!pin || !pin.id || !pin.images) return null;
      const thumb = pin.images['236x']?.url || '';
      if (!thumb) return null;
      return {
        id: String(pin.id),
        url: thumb,
        thumbnail: thumb,
        medium: pin.images['474x']?.url || pin.images['564x']?.url || transformImageUrl(thumb, '474x'),
        large: pin.images['736x']?.url || pin.images['564x']?.url || transformImageUrl(thumb, '736x'),
        original: pin.images['orig']?.url || pin.images['originals']?.url || transformImageUrl(thumb, 'originals'),
        title: pin.title || pin.grid_title || '',
        description: pin.description || ''
      };
    };
    
    // Helper to normalize and filter URLs after harvesting
    const shouldKeepUrl = (u: string) => {
      if (!u) return false;
      if (!u.includes('i.pinimg.com/')) return false;
      // Skip obvious non-pin assets and media formats
      if (
        u.includes('/user/') ||
        u.includes('/avatars/') ||
        u.includes('/static/') ||
        u.includes('/boards/') ||
        u.includes('/closeup/') ||
        u.endsWith('.gif') ||
        u.endsWith('.mp4') ||
        u.endsWith('.webm')
      ) {
        return false;
      }
      // Enforce allowed Pinterest pin dimensions
      const dim = getDimensionFromUrl(u);
      const allowed = new Set(['170x', '236x', '474x', '564x', '736x', 'originals']);
      if (!dim || !allowed.has(dim)) return false;

      // Enforce pin-like filename hash
      const hash = getHashFromUrl(u);
      if (!hash || !isValidPinHash(hash)) return false;

      return true;
    };

    // Extract hash/id from a pin image URL (filename without extension)
    const getHashFromUrl = (u: string): string | null => {
      try {
        const pathname = new URL(u).pathname;
        const last = pathname.split('/').filter(Boolean).pop() || '';
        const base = last.split('.')[0];
        return base || null;
      } catch {
        const parts = u.split('/');
        const last = parts[parts.length - 1] || '';
        return (last.split('.')[0] || null);
      }
    };

    // Extract the Pinterest dimension segment (e.g., 236x, 736x, originals)
    const getDimensionFromUrl = (u: string): string | null => {
      const m = u.match(/https:\/\/i\.pinimg\.com\/(\d+x|\w+)\//);
      return m ? m[1] : null;
    };

    // Validate that a filename base looks like a real pin hash
    const isValidPinHash = (hash: string): boolean =>
      /^[0-9a-f]{16,}$/i.test(hash);

    try {
      console.log('🎭 Starting Playwright (core) browser automation...');
      let chromium: any | undefined;

      try {
        // Prefer full playwright if installed (brings browsers + API)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - optional dependency; handled via runtime try/catch
        const pw = await import('playwright').catch(() => null);
        if (pw?.chromium) {
          chromium = pw.chromium;
        } else {
          // Fallback to playwright-core (API only; requires separate browser install)
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore - optional dependency, resolved only at runtime if installed
          const pwCore = await import(('playwright' + '-core') as string);
          chromium = pwCore.chromium;
        }
      } catch (e) {
        console.log('Neither playwright nor playwright-core available, skipping automation:', (e as Error)?.message || e);
        throw e;
      }

      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 2000 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
      });
      const page = await context.newPage();

      // Capture BoardFeedResource responses to extract pins directly during scrolls
      page.on('response', async (res: any) => {
        try {
          const u = res.url();
          if (u.includes('/resource/BoardFeedResource/get')) {
            const data = await res.json();
            const results = data?.resource_response?.data?.results || data?.resource_response?.data || [];
            for (const pin of Array.isArray(results) ? results : []) {
              const img = buildImageFromPin(pin);
              if (img && !networkPins.has(img.id)) {
                networkPins.set(img.id, img);
              }
            }
          }
        } catch {
          // ignore non-JSON or parse errors
        }
      });

      // Step 1: Navigate to Pinterest board
      await page.goto(boardUrl, { waitUntil: 'networkidle' });
      console.log('✅ Navigated to Pinterest board');

      // Opportunistically dismiss overlays if present
      try {
        // Press Escape and remove common dialog overlays if any
        await page.keyboard.press('Escape').catch(() => {});
        await page.evaluate(() => {
          const dialogs = document.querySelectorAll('[role="dialog"], [data-test-id*="Signup"], [data-test-id*="login"]');
          dialogs.forEach(d => (d as HTMLElement).style.display = 'none');
          const style = document.createElement('style');
          style.textContent = `
            *[style*="position: fixed"][style*="z-index"] { display: none !important; }
          `;
          document.head.appendChild(style);
        }).catch(() => {});
      } catch { /* no-op */ }

      // Step 2: Infinite scroll to load all pins
      const maxScrolls = 120;
      let lastHeight = 0;

      for (let i = 0; i < maxScrolls; i++) {
        const currentHeight = await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          return document.body.scrollHeight;
        });

        // If no growth in height, wait and recheck once before breaking
        if (currentHeight === lastHeight) {
          await page.waitForTimeout(1200);
          const recheck = await page.evaluate(() => document.body.scrollHeight);
          if (recheck === lastHeight) {
            console.log(`✅ Reached end of content after ${i} scrolls`);
            break;
          }
        }

        lastHeight = currentHeight;
        scrollCount = i + 1;

        // Let Pinterest lazy-load images/content between scrolls
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(700);
        console.log(`📜 Scroll ${scrollCount}: page height ${currentHeight}px`);
      }

      // Step 3: Use in-page BoardFeedResource pagination to collect pins (with cookies)
      try {
        const parts = parseBoardUrl(boardUrl);
        if (parts?.username && parts?.slug) {
          const apiPinsRaw = await page.evaluate(async (parts: { username: string; slug: string }) => {
            const collected: any[] = [];
            let bookmark: string | undefined = undefined;
            for (let i = 0; i < 30; i++) {
              const params: any = new URLSearchParams({
                source_url: `/${parts.username}/${parts.slug}/`,
                data: JSON.stringify({
                  options: {
                    board_url: `/${parts.username}/${parts.slug}/`,
                    field_set_key: 'react_grid_pin',
                    filter_section_pins: false,
                    sort: 'default',
                    layout: 'default',
                    page_size: 250,
                    ...(bookmark ? { bookmarks: [bookmark] } : {})
                  },
                  context: {}
                })
              });
              const url = `https://www.pinterest.com/resource/BoardFeedResource/get/?${params.toString()}`;
              const resp = await fetch(url, {
                headers: {
                  'X-Requested-With': 'XMLHttpRequest',
                  'X-Pinterest-AppState': 'active',
                  'Accept': 'application/json, text/javascript, */*; q=0.01',
                  'Referer': `https://www.pinterest.com/${parts.username}/${parts.slug}/`
                }
              });
              if (!resp.ok) break;
              const data = await resp.json();
              const results = data?.resource_response?.data?.results || data?.resource_response?.data || [];
              for (const pin of Array.isArray(results) ? results : []) {
                collected.push(pin);
              }
              bookmark =
                data?.resource?.options?.bookmarks?.[0] ||
                data?.resource_response?.bookmark ||
                data?.resource_response?.data?.bookmark ||
                data?.bookmark;
              if (!bookmark) break;
              await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 300)));
            }
            return collected;
          }, parts);

          for (const pin of apiPinsRaw as any[]) {
            const img = buildImageFromPin(pin);
            if (img && !networkPins.has(img.id)) {
              networkPins.set(img.id, img);
            }
          }
          console.log(`🛰️ In-page API captured ${networkPins.size} pins so far`);
        }
      } catch (e) {
        console.log('In-page API pagination failed:', (e as Error)?.message || e);
      }
// Step 3b: Fetch pins from board sections via internal APIs (in-page, with cookies)
try {
  const parts = parseBoardUrl(boardUrl);
  if (parts?.username && parts?.slug) {
    const sectionPinsRaw = await page.evaluate(async (parts: { username: string; slug: string }) => {
      const headers = {
        'X-Requested-With': 'XMLHttpRequest',
        'X-Pinterest-AppState': 'active',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': `https://www.pinterest.com/${parts.username}/${parts.slug}/`
      } as Record<string, string>;

      const collected: any[] = [];

      try {
        // Enumerate board sections
        const secParams: any = new URLSearchParams({
          source_url: `/${parts.username}/${parts.slug}/`,
          data: JSON.stringify({
            options: {
              board_url: `/${parts.username}/${parts.slug}/`
            },
            context: {}
          })
        });
        const secUrl = `https://www.pinterest.com/resource/BoardSectionsResource/get/?${secParams.toString()}`;
        const secResp = await fetch(secUrl, { headers });
        if (secResp.ok) {
          const secData = await secResp.json();
          const sections = secData?.resource_response?.data?.sections || secData?.resource_response?.data || [];
          for (const section of Array.isArray(sections) ? sections : []) {
            // Try multiple section endpoints to maximize coverage
            const endpointNames = ['BoardSectionPinsResource', 'BoardSectionFeedResource'];
            for (const ep of endpointNames) {
              let bookmark: string | undefined = undefined;
              for (let i = 0; i < 20; i++) {
                const p: any = new URLSearchParams({
                  source_url: `/${parts.username}/${parts.slug}/`,
                  data: JSON.stringify({
                    options: {
                      board_url: `/${parts.username}/${parts.slug}/`,
                      section_id: section.id,
                      field_set_key: 'react_grid_pin',
                      sort: 'default',
                      layout: 'default',
                      page_size: 250,
                      ...(bookmark ? { bookmarks: [bookmark] } : {})
                    },
                    context: {}
                  })
                });
                const url = `https://www.pinterest.com/resource/${ep}/get/?${p.toString()}`;
                const r = await fetch(url, { headers });
                if (!r.ok) break;
                const d = await r.json();
                const results = d?.resource_response?.data?.results || d?.resource_response?.data || [];
                for (const pin of Array.isArray(results) ? results : []) {
                  collected.push(pin);
                }
                bookmark =
                  d?.resource?.options?.bookmarks?.[0] ||
                  d?.resource_response?.bookmark ||
                  d?.resource_response?.data?.bookmark ||
                  d?.bookmark;
                if (!bookmark) break;
                await new Promise(res => setTimeout(res, 300 + Math.floor(Math.random() * 300)));
              }
            }
          }
        }
      } catch {
        // ignore section enumeration errors
      }

      return collected;
    }, parts);

    for (const pin of sectionPinsRaw as any[]) {
      const img = buildImageFromPin(pin);
      if (img && !networkPins.has(img.id)) {
        networkPins.set(img.id, img);
      }
    }
    console.log(`🗂️ Sections API captured ${Array.isArray(sectionPinsRaw) ? sectionPinsRaw.length : 0} pins (cumulative ${networkPins.size})`);
  }
} catch (e) {
  console.log('Sections API scraping failed:', (e as Error)?.message || e);
}

// Step 3c: Fetch missing pins by DOM-detected pin ids via PinResource (in-page, with cookies)
try {
  const parts2 = parseBoardUrl(boardUrl);
  if (parts2?.username && parts2?.slug) {
    const knownNetworkIds = Array.from(networkPins.keys());
    const domDetailPinsRaw = await page.evaluate(
      async (knownIds: string[], parts: { username: string; slug: string }) => {
        const headers = {
          'X-Requested-With': 'XMLHttpRequest',
          'X-Pinterest-AppState': 'active',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Referer': `https://www.pinterest.com/${parts.username}/${parts.slug}/`
        } as Record<string, string>;

        // Collect pin ids present in the DOM
        const anchors = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
        const idSet = new Set<string>();
        for (const a of anchors) {
          const href = (a as HTMLAnchorElement).getAttribute('href') || '';
          const m = href.match(/\/pin\/(\d{8,})/);
          if (m && m[1]) idSet.add(m[1]);
        }

        // Determine which ids are missing from network-captured pins
        const missing = Array.from(idSet).filter(id => !knownIds.includes(id));
        const collected: any[] = [];

        // Fetch missing pin details via PinResource (throttled)
        for (const pinId of missing) {
          try {
            const params = new URLSearchParams({
              source_url: `/${parts.username}/${parts.slug}/`,
              data: JSON.stringify({
                options: {
                  id: pinId
                },
                context: {}
              })
            });
            const url = `https://www.pinterest.com/resource/PinResource/get/?${params.toString()}`;
            const resp = await fetch(url, { headers });
            if (!resp.ok) continue;
            const data = await resp.json();
            const pin = data?.resource_response?.data;
            if (pin && pin.id) {
              collected.push(pin);
            }
            // Small jittered delay to be polite
            await new Promise(res => setTimeout(res, 250 + Math.floor(Math.random() * 250)));
          } catch {
            // ignore individual pin fetch errors
          }
          // Safety cap
          if (collected.length > 300) break;
        }

        return collected;
      },
      knownNetworkIds,
      parts2
    );

    for (const pin of domDetailPinsRaw as any[]) {
      const img = buildImageFromPin(pin);
      if (img && !networkPins.has(img.id)) {
        networkPins.set(img.id, img);
      }
    }
    console.log(
      `🔎 PinResource detail filled ${Array.isArray(domDetailPinsRaw) ? domDetailPinsRaw.length : 0} pins (cumulative ${networkPins.size})`
    );
  }
} catch (e) {
  console.log('PinResource detail fetch failed:', (e as Error)?.message || e);
}
      // Step 4: Harvest all image URLs from DOM (src + srcset)
      harvestedUrls = await page.evaluate(() => {
        const urls = new Set<string>();
        const add = (u: string | null | undefined) => { if (u) urls.add(u); };
        const imgs = Array.from(document.querySelectorAll('img'));
        for (const img of imgs) {
          add(img.getAttribute('src'));
          const srcset = img.getAttribute('srcset');
          if (srcset) {
            for (const part of srcset.split(',')) {
              const u = part.trim().split(' ')[0];
              add(u);
            }
          }
        }
        return Array.from(urls);
      });

      // Step 4: Capture final HTML too (as a fallback to regex)
      finalHtml = await page.content();
      await browser.close();

      playwrightSuccess = !!finalHtml || harvestedUrls.length > 0;
      console.log(`✅ Playwright automation complete: ${scrollCount} scrolls, DOM urls ${harvestedUrls.length}, html ${finalHtml.length} chars`);
    } catch (error) {
      console.log('🚨 Playwright automation failed, falling back to static scraping:', error);
      playwrightSuccess = false;
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
    
    // Build images preferring network-captured pins, then DOM-harvest, then (strict) HTML supplement
    let imagesMap = new Map<string, PinterestImage>();
    if (networkPins.size > 0) {
      console.log(`🛰️ Network-captured pins: ${networkPins.size}`);
      for (const img of networkPins.values()) imagesMap.set(img.id, img);
    }
    // Hashes and IDs derived from network-captured pins (BoardFeedResource) to validate DOM/HTML items belong to the board
    const networkHashes = new Set<string>();
    const networkPinIds = new Set<string>();
    for (const pin of networkPins.values()) {
      const h = getHashFromUrl(pin.thumbnail || pin.url);
      if (h) networkHashes.add(h);
      if (pin.id) networkPinIds.add(String(pin.id));
    }

    // Merge DOM-harvested URLs
    if (harvestedUrls.length > 0) {
      const seen = new Set<string>(imagesMap.keys());
      const allowed = new Set(['236x', '474x', '564x', '736x', 'originals']);
      for (const raw of harvestedUrls) {
        if (!shouldKeepUrl(raw)) continue;

        // Enforce allowed dimensions (exclude 170x to reduce suggested/search items)
        const dim = getDimensionFromUrl(raw);
        if (!dim || !allowed.has(dim)) continue;

        // Normalize to 236x thumbnail (source may be any allowed dimension)
        const thumb = transformImageUrl(raw, '236x');

        const id = getHashFromUrl(thumb);
        // Only accept DOM entries that correspond to a hash we also saw via BoardFeedResource
        if (!id || !isValidPinHash(id) || seen.has(id) || !networkHashes.has(id)) continue;

        seen.add(id);

        imagesMap.set(id, {
          id,
          url: thumb,
          thumbnail: thumb,
          medium: transformImageUrl(raw, '474x'),
          large: transformImageUrl(raw, '736x'),
          original: transformImageUrl(raw, 'originals'),
          title: '',
          description: ''
        });
      }
      console.log(`🧭 DOM-harvest contributed ${Math.max(0, imagesMap.size - (networkPins.size || 0))} pins (cumulative ${imagesMap.size})`);
    }

    // Supplement with HTML extractor (restricted to network-confirmed items) and capture board info
    const { images: htmlPins, boardInfo: htmlBoardInfo } = extractImagesFromHtml(finalHtml);
    if (htmlPins?.length && (networkHashes.size > 0 || networkPinIds.size > 0)) {
      let added = 0;
      for (const p of htmlPins) {
        if (!p) continue;

        // Derive an image hash from any available URL field
        const candidateUrl =
          p.thumbnail || p.url || p.medium || p.large || p.original || '';
        const candidateHash = candidateUrl ? getHashFromUrl(candidateUrl) : null;

        // Validate against either known network image hashes OR known network pin ids
        const matchesNetworkHash = candidateHash ? networkHashes.has(candidateHash) : false;
        const matchesNetworkId = p.id ? networkPinIds.has(String(p.id)) : false;

        if (!matchesNetworkHash && !matchesNetworkId) continue;

        // Use a stable map key; prefer id if present, else fall back to candidate hash
        const key = p.id || candidateHash;
        if (!key) continue;

        if (!imagesMap.has(key)) {
          // Normalize the object to carry consistent id (prefer numeric id; else hash)
          const normalized: PinterestImage = {
            ...p,
            id: String(key),
            thumbnail: p.thumbnail || (candidateUrl ? transformImageUrl(candidateUrl, '236x') : p.thumbnail),
            medium: p.medium || (candidateUrl ? transformImageUrl(candidateUrl, '474x') : p.medium),
            large: p.large || (candidateUrl ? transformImageUrl(candidateUrl, '736x') : p.large),
            original: p.original || (candidateUrl ? transformImageUrl(candidateUrl, 'originals') : p.original)
          };
          imagesMap.set(key, normalized);
          added++;
        }
      }
      console.log(`🔁 After HTML supplement (network-validated): +${added}, total ${imagesMap.size} pins`);
    } else {
      console.log(
        `🔁 HTML supplement skipped (networkHashes=${networkHashes.size}, networkPinIds=${networkPinIds.size})`
      );
    }
    const boardInfoResolved = htmlBoardInfo;

    let finalImages: PinterestImage[] = Array.from(imagesMap.values());

    // Confirmation check only (no clamping)
    const targetCount = (boardInfoResolved?.pinCount && Number.isFinite(boardInfoResolved.pinCount))
      ? boardInfoResolved.pinCount
      : undefined;
    if (targetCount && finalImages.length !== targetCount) {
      console.log(`Pin count mismatch (reported ${targetCount} vs scraped ${finalImages.length})`);
    }

    const executionTime = Date.now() - startTime;
    
    const result = {
      success: true,
      method: playwrightSuccess ? 'playwright-automation+dom-harvest' : 'static-fallback',
      totalPinsFound: finalImages.length,
      targetPins: targetCount || finalImages.length,
      completionPercentage: Math.round((finalImages.length / (targetCount || finalImages.length)) * 100),
      executionTimeMs: executionTime,
      images: finalImages,
      boardInfo: boardInfoResolved || {
        name: 'moodboard',
        url: boardUrl,
        pinCount: finalImages.length,
        owner: ''
      },
      metadata: {
        playwrightSuccess,
        scrapingMethod: playwrightSuccess ? 'Browser automation with infinite scroll + DOM harvest' : 'Enhanced static HTML scraping',
        networkRequests: playwrightSuccess ? 'Browser automation' : 'Static request only',
        scrolls: playwrightSuccess ? scrollCount : 'No scrolling',
        harvestedUrlCount: harvestedUrls.length
      },
      message: targetCount
        ? `Found ${finalImages.length} of ${targetCount} board pins`
        : `Found ${finalImages.length} pins.`
    };
    
    console.log(`🎯 Scraping complete: ${finalImages.length} pins in ${executionTime}ms using ${result.method}`);
    
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
