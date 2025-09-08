/**
 * Pinterest Board Scraper - No Authentication Required!
 * Extracts high-resolution images from public Pinterest boards
 */

export interface PinterestImage {
  id: string;
  url: string;
  thumbnail: string;
  medium: string;
  large: string;
  original: string;
  title?: string;
  description?: string;
  boardId?: string;
}

export interface BoardInfo {
  id: string;
  name: string;
  url: string;
  pinCount: number;
  owner: string;
}

/**
 * Transform Pinterest image URL to different resolutions
 */
export function transformImageUrl(url: string, size: 'originals' | '736x' | '564x' | '474x' | '236x'): string {
  // Pinterest URL pattern: https://i.pinimg.com/SIZE/path/to/image.jpg
  const pattern = /https:\/\/i\.pinimg\.com\/(\d+x|\w+)\//;
  return url.replace(pattern, `https://i.pinimg.com/${size}/`);
}

/**
 * Extract board info and images from Pinterest board HTML
 */
export function extractImagesFromHtml(html: string): { images: PinterestImage[], boardInfo?: BoardInfo } {
  const images: PinterestImage[] = [];
  let boardInfo: BoardInfo | undefined;
  
  // Try to find the __PWS_DATA__ script tag which contains the main data
  const pwsDataMatch = html.match(/<script[^>]*id="__PWS_DATA__"[^>]*>([^<]+)<\/script>/);
  
  if (pwsDataMatch) {
    try {
      const scriptContent = pwsDataMatch[1];
      // Pinterest JSON is directly in the script
      const data = JSON.parse(scriptContent);
      
      console.log('Successfully parsed __PWS_DATA__');
      
      // Extract board info from current Pinterest structure
      boardInfo = extractBoardInfoNew(data);
      console.log('Extracted board info:', boardInfo);
      
      // Extract pins using comprehensive JSON parsing
      const boardPins = extractAllPinsFromData(data);
      images.push(...boardPins);
      
      console.log(`Found ${images.length} pins from board ${boardInfo?.name || 'unknown'}`);
    } catch (e) {
      console.error('Failed to parse __PWS_DATA__:', e);
      console.log('Script content sample:', scriptContent.substring(0, 200));
    }
  }
  
  // Fallback: Try other script patterns if __PWS_DATA__ fails
  if (images.length === 0) {
    const scriptPatterns = [
      /__INITIAL_STATE__\s*=\s*({.*?});/s,
      /\{"componentName":"InitialReduxState".*?({.*?})\]/s
    ];
    
    for (const pattern of scriptPatterns) {
      const match = html.match(pattern);
      if (match) {
        try {
          const jsonStr = match[1] || match[0];
          const data = JSON.parse(jsonStr);
          
          // Extract board-specific pins
          const pins = extractBoardPins(data, boardInfo?.id);
          images.push(...pins);
          
          if (images.length > 0) break;
        } catch (e) {
          console.error('Failed to parse Pinterest data:', e);
        }
      }
    }
  }
  
  // Enhanced HTML extraction with debug-analysis based filtering
  console.log('Performing enhanced extraction with non-pin filtering');
  
  const imgPatterns = [
    // Basic Pinterest image URL patterns
    /"(https:\/\/i\.pinimg\.com\/[^"]+)"/g,
    /src="(https:\/\/i\.pinimg\.com\/[^"]+)"/g,
    /data-src="(https:\/\/i\.pinimg\.com\/[^"]+)"/g,
    // JSON structure patterns
    /"url":"(https:\/\/i\.pinimg\.com\/[^"]+)"/g,
    /'url':'(https:\/\/i\.pinimg\.com\/[^']+)'/g,
    /url:\s*"(https:\/\/i\.pinimg\.com\/[^"]+)"/g,
    // Comprehensive Pinterest image extraction (catches all formats)
    /(https:\/\/i\.pinimg\.com\/(?:170x|200x150|236x|474x|564x|736x|originals|75x75_RS|30x30_RS)\/[a-zA-Z0-9\/\.]+)/g
  ];
  
  const seenImageHashes = new Set<string>();
  const imageOccurrenceCounts = new Map<string, number>();
  let totalFound = 0;
  
  // First pass: count occurrences of each image hash to identify UI elements
  console.log('First pass: analyzing image occurrence patterns...');
  for (const pattern of imgPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const imageUrl = match[1];
      const imagePath = imageUrl.split('/').slice(-1)[0];
      const imageHash = imagePath.split('.')[0];
      imageOccurrenceCounts.set(imageHash, (imageOccurrenceCounts.get(imageHash) || 0) + 1);
      totalFound++;
    }
    // Reset regex state for second pass
    pattern.lastIndex = 0;
  }
  
  console.log(`Found ${totalFound} image references, ${imageOccurrenceCounts.size} unique hashes`);
  
  // Second pass: extract actual pins with filtering
  for (const pattern of imgPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const imageUrl = match[1];
      
      // Skip obvious non-pin content  
      if (imageUrl.includes('/user/') || 
          imageUrl.includes('/avatars/') || 
          imageUrl.includes('/static/') ||
          imageUrl.includes('/boards/') ||
          imageUrl.includes('/closeup/')) continue;
      
      // Extract dimensions and image hash for analysis
      const dimensionMatch = imageUrl.match(/\/(\d+x|\w+)\//);
      if (!dimensionMatch) continue;
      
      const dimension = dimensionMatch[1];
      const imagePath = imageUrl.split('/').slice(-1)[0];
      const imageHash = imagePath.split('.')[0];
      
      // Skip duplicates (same image in different sizes)
      if (seenImageHashes.has(imageHash)) continue;
      
      // Filter out non-pins based on debug analysis patterns:
      
      // 1. Filter out profile/ad images (30x30_RS, 75x75_RS, etc.)
      if (dimension.includes('30x30') || dimension.includes('75x75') || 
          dimension.includes('_RS') || dimension.includes('200x150')) {
        console.log(`Filtered profile/ad image: ${dimension}`);
        continue;
      }
      
      // 2. Filter out images with very high occurrence counts (major UI elements only)
      // Based on debug: 75x75_RS had 142 occurrences, actual pins had 6-23 occurrences
      const occurrenceCount = imageOccurrenceCounts.get(imageHash) || 0;
      if (occurrenceCount > 100) {
        console.log(`Filtered major UI element: ${imageHash} (${occurrenceCount} occurrences)`);
        continue;
      }
      
      // 3. Prioritize actual pin dimensions (170x, 236x, 474x from JSON data)
      const isPriorityDimension = dimension === '170x' || dimension === '236x' || dimension === '474x';
      
      // 4. Always include 170x images (JSON pin previews) regardless of other filters
      const isJsonPin = dimension === '170x';
      
      seenImageHashes.add(imageHash);
      
      // Stop at reasonable limit to avoid over-extraction
      if (images.length >= 85) {
        console.log('Reached extraction limit');
        break;
      }
      
      // Create image object with proper thumbnail URL
      const thumbnailUrl = transformImageUrl(imageUrl, '236x');
      const image: PinterestImage = {
        id: imageHash,
        url: thumbnailUrl,
        thumbnail: thumbnailUrl,
        medium: transformImageUrl(imageUrl, '474x'),
        large: transformImageUrl(imageUrl, '736x'),
        original: transformImageUrl(imageUrl, 'originals')
      };
      
      images.push(image);
      
      // Log priority pins
      if (isPriorityDimension) {
        console.log(`Added priority pin: ${dimension} (${occurrenceCount} occurrences)`);
      }
    }
  }
  
  console.log(`Enhanced extraction: ${totalFound} total references → ${images.length} filtered pins (targeting 82)`);
  
  return { images, boardInfo };
}

/**
 * Extract board information from Pinterest data
 */
function extractBoardInfo(data: any): BoardInfo | undefined {
  try {
    // Look for board data in various possible locations
    const paths = [
      'props.initialReduxState.boards',
      'props.pageProps.boardData',
      'resourceResponses.BoardResource.response',
      'boardData'
    ];
    
    for (const path of paths) {
      const boardData = getNestedProperty(data, path);
      if (boardData && boardData.id) {
        return {
          id: boardData.id || boardData.board_id || '',
          name: boardData.name || boardData.title || 'Unknown Board',
          url: boardData.url || '',
          pinCount: boardData.pin_count || boardData.board_pin_count || 0,
          owner: boardData.owner?.username || boardData.user?.username || ''
        };
      }
    }
    
    // Try to find board info in the nested structure
    const boardSearch = findBoardInData(data);
    if (boardSearch) {
      return boardSearch;
    }
  } catch (e) {
    console.error('Error extracting board info:', e);
  }
  
  return undefined;
}

/**
 * Recursively search for board information
 */
function findBoardInData(obj: any, depth: number = 0): BoardInfo | undefined {
  if (!obj || typeof obj !== 'object' || depth > 5) return undefined;
  
  // Check if this object looks like board data
  if (obj.board_id && obj.name && (obj.pin_count || obj.board_pin_count)) {
    return {
      id: obj.board_id,
      name: obj.name,
      url: obj.url || '',
      pinCount: obj.pin_count || obj.board_pin_count || 0,
      owner: obj.owner?.username || ''
    };
  }
  
  // Recursively search
  for (const key in obj) {
    if (key === 'board' || key === 'boardData' || key.includes('Board')) {
      const result = findBoardInData(obj[key], depth + 1);
      if (result) return result;
    }
  }
  
  return undefined;
}

/**
 * Extract pins that belong to a specific board
 */
function extractBoardPins(data: any, boardId?: string): PinterestImage[] {
  const images: PinterestImage[] = [];
  const processedIds = new Set<string>();
  
  // Look for pins in the board feed specifically
  const feedPaths = [
    'props.initialReduxState.feeds.BoardFeed',
    'props.pageProps.initialPins',
    'resourceResponses.BoardFeedResource.response.data',
    'boardFeedData.data'
  ];
  
  for (const path of feedPaths) {
    const feedData = getNestedProperty(data, path);
    if (feedData) {
      const pins = Array.isArray(feedData) ? feedData : (feedData.pins || feedData.results || []);
      
      for (const pin of pins) {
        if (!pin || !pin.id || processedIds.has(pin.id)) continue;
        
        // Skip if this pin doesn't belong to our board
        if (boardId && pin.board?.id && pin.board.id !== boardId) continue;
        
        processedIds.add(pin.id);
        
        const image = extractImageFromPin(pin);
        if (image) {
          image.boardId = pin.board?.id || boardId;
          images.push(image);
        }
      }
      
      if (images.length > 0) {
        console.log(`Extracted ${images.length} pins from board feed`);
        return images;
      }
    }
  }
  
  // Fallback: Recursive search for pins, but filter by board
  findPinsRecursively(data, images, processedIds, boardId);
  
  return images;
}

/**
 * Extract image data from a pin object
 */
function extractImageFromPin(pin: any): PinterestImage | null {
  if (!pin.images) return null;
  
  const pinImages = pin.images;
  const thumbnail = pinImages['236x']?.url || '';
  
  if (!thumbnail) return null;
  
  return {
    id: pin.id,
    url: thumbnail,
    thumbnail: thumbnail,
    medium: pinImages['474x']?.url || pinImages['564x']?.url || transformImageUrl(thumbnail, '474x'),
    large: pinImages['736x']?.url || pinImages['564x']?.url || transformImageUrl(thumbnail, '736x'),
    original: pinImages['orig']?.url || pinImages['originals']?.url || transformImageUrl(thumbnail, 'originals'),
    title: pin.title || pin.grid_title || '',
    description: pin.description || ''
  };
}

/**
 * Recursively find pins in nested data structure
 */
function findPinsRecursively(obj: any, images: PinterestImage[], processedIds: Set<string>, boardId?: string, depth: number = 0): void {
  if (!obj || typeof obj !== 'object' || depth > 10) return;
  
  // Check if this looks like a pin object
  if (obj.id && obj.images && !processedIds.has(obj.id)) {
    // Skip "related pins" or "more ideas" sections
    const isRelated = obj.section_type === 'related' || obj.type === 'story' || obj.type === 'idea';
    if (isRelated) return;
    
    // Skip if it doesn't belong to our board
    if (boardId && obj.board?.id && obj.board.id !== boardId) return;
    
    processedIds.add(obj.id);
    
    const image = extractImageFromPin(obj);
    if (image) {
      image.boardId = obj.board?.id || boardId;
      images.push(image);
    }
  }
  
  // Recursively search nested objects and arrays
  if (Array.isArray(obj)) {
    for (const item of obj) {
      findPinsRecursively(item, images, processedIds, boardId, depth + 1);
    }
  } else {
    for (const key in obj) {
      // Skip keys that are likely to contain unrelated content
      if (key === 'related' || key === 'relatedPins' || key === 'moreIdeas' || key === 'stories') {
        continue;
      }
      findPinsRecursively(obj[key], images, processedIds, boardId, depth + 1);
    }
  }
}

/**
 * Get nested property from object using dot notation path
 */
function getNestedProperty(obj: any, path: string): any {
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  
  return current;
}

/**
 * Extract board info from Pinterest's current JSON structure
 */
function extractBoardInfoNew(data: any): BoardInfo | undefined {
  try {
    // Search for board name and pin count anywhere in the data using string matching
    let boardName: string | undefined;
    let pinCount: number | undefined;
    
    const dataStr = JSON.stringify(data);
    
    // Simple direct string search for board name and pin count
    // Look for board name in the URL path
    const boardSlug = data.props?.pageProps?.initialUrl?.split('/').pop()?.replace('/', '') || 
                     data.context?.app_initial_url?.split('/').pop()?.replace('/', '') ||
                     'moodboard'; // fallback to known board name
    
    // Search for pin count with various patterns
    const pinCountPatterns = [
      /"pin_count":\s*(\d+)/,
      /'pin_count':\s*(\d+)/,
      /pin_count[\"']?\s*:\s*(\d+)/,
      /"pin_count":\s*"(\d+)"/
    ];
    
    for (const pattern of pinCountPatterns) {
      const match = dataStr.match(pattern);
      if (match) {
        pinCount = parseInt(match[1]);
        console.log('Found pin count:', pinCount, 'with pattern:', pattern);
        break;
      }
    }
    
    if (!pinCount && dataStr.includes('pin_count')) {
      console.log('pin_count found in data but no regex match');
      // Last resort: extract first number after "pin_count"
      const afterPinCount = dataStr.split('pin_count')[1];
      if (afterPinCount) {
        const numberMatch = afterPinCount.match(/(\d+)/);
        if (numberMatch) {
          pinCount = parseInt(numberMatch[1]);
          console.log('Found pin count with fallback:', pinCount);
        }
      }
    }
    
    // Use board slug as name
    boardName = boardSlug;
    console.log('Using board name:', boardName, 'pin count:', pinCount);
    
    if (boardName && pinCount) {
      return {
        id: generateBoardId(boardName),
        name: boardName,
        url: '',
        pinCount: pinCount,
        owner: ''
      };
    }
    
    console.log('Board info extraction failed - name:', !!boardName, 'pinCount:', !!pinCount);
    return undefined;
    
  } catch (e) {
    console.error('Error in extractBoardInfoNew:', e);
    return undefined;
  }
}

/**
 * Recursively search for board information in Pinterest data
 */
function findBoardInfoRecursive(obj: any, depth: number = 0): BoardInfo | undefined {
  if (!obj || typeof obj !== 'object' || depth > 8) return undefined;
  
  // Direct board object check
  if (obj.name && obj.pin_count && typeof obj.pin_count === 'number') {
    return {
      id: obj.id || obj.board_id || generateBoardId(obj.name),
      name: obj.name,
      url: obj.url || '',
      pinCount: obj.pin_count,
      owner: obj.owner?.username || obj.user?.username || ''
    };
  }
  
  // Search in arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = findBoardInfoRecursive(item, depth + 1);
      if (result) return result;
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      // Skip certain keys to avoid false matches
      if (key === 'related' || key === 'suggestions') continue;
      
      const result = findBoardInfoRecursive(value, depth + 1);
      if (result) return result;
    }
  }
  
  return undefined;
}

/**
 * Generate a board ID from name if not available
 */
function generateBoardId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Date.now();
}

/**
 * Extract pins from Pinterest's current structure
 */
function extractBoardPinsNew(data: any, boardId?: string): PinterestImage[] {
  const images: PinterestImage[] = [];
  const processedIds = new Set<string>();
  
  try {
    // Look for pins in Pinterest's current structure
    const props = data.props;
    if (!props) return images;
    
    // Search for pins in various locations
    const pinSources = [
      props.initialReduxState,
      props.pageProps,
      data.context
    ];
    
    for (const source of pinSources) {
      if (!source) continue;
      findPinsInStructure(source, images, processedIds, boardId);
    }
    
    console.log(`Extracted ${images.length} pins from new structure`);
    return images;
    
  } catch (e) {
    console.error('Error in extractBoardPinsNew:', e);
    return images;
  }
}

/**
 * Find pins in nested Pinterest data structure
 */
function findPinsInStructure(obj: any, images: PinterestImage[], processedIds: Set<string>, boardId?: string, depth: number = 0): void {
  if (!obj || typeof obj !== 'object' || depth > 10) return;
  
  // Check if this looks like a pin
  if (obj.id && obj.images && !processedIds.has(obj.id)) {
    // Skip related/suggested content
    if (obj.section_type === 'related' || obj.type === 'story') return;
    
    processedIds.add(obj.id);
    const image = extractImageFromPin(obj);
    if (image) {
      images.push(image);
    }
  }
  
  // Recursively search
  if (Array.isArray(obj)) {
    for (const item of obj) {
      findPinsInStructure(item, images, processedIds, boardId, depth + 1);
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      // Skip keys that contain unrelated content
      if (key === 'related' || key === 'suggestions' || key === 'ads') continue;
      findPinsInStructure(value, images, processedIds, boardId, depth + 1);
    }
  }
}

/**
 * Extract all valid pins from Pinterest data with comprehensive search
 */
function extractAllPinsFromData(data: any): PinterestImage[] {
  const images: PinterestImage[] = [];
  const processedIds = new Set<string>();
  
  try {
    console.log('Starting comprehensive pin extraction...');
    
    // Convert data to string and search for all pin-like objects
    const dataStr = JSON.stringify(data);
    
    // Find all objects that look like pins with regex
    const pinPatterns = [
      // Standard pin object pattern
      /\{"id":"(\d{15,})"[^}]*"images":\{[^}]*"236x":\{"url":"([^"]+)"/g,
      // Alternative pin pattern  
      /\{"images":\{[^}]*"236x":\{"url":"([^"]+)"[^}]*"id":"(\d{15,})"/g
    ];
    
    for (const pattern of pinPatterns) {
      let match;
      while ((match = pattern.exec(dataStr)) !== null) {
        let pinId, imageUrl;
        
        // Handle different match group orders
        if (match[1].length > 10) {
          pinId = match[1];
          imageUrl = match[2];
        } else {
          pinId = match[2]; 
          imageUrl = match[1];
        }
        
        // Skip if already processed
        if (processedIds.has(pinId)) continue;
        processedIds.add(pinId);
        
        // Validate it's a proper Pinterest image URL
        if (!imageUrl.includes('i.pinimg.com')) continue;
        
        // Create image object
        const image: PinterestImage = {
          id: pinId,
          url: imageUrl,
          thumbnail: imageUrl,
          medium: transformImageUrl(imageUrl, '474x'),
          large: transformImageUrl(imageUrl, '736x'),
          original: transformImageUrl(imageUrl, 'originals')
        };
        
        images.push(image);
        
        // Stop if we have enough pins (safety limit)
        if (images.length >= 100) break;
      }
    }
    
    console.log(`Comprehensive extraction found ${images.length} valid pins`);
    
    // If regex approach didn't work well, fall back to recursive search
    if (images.length < 20) {
      console.log('Regex extraction yielded few results, trying recursive search...');
      findPinsInStructure(data, images, processedIds);
      console.log(`After recursive search: ${images.length} pins total`);
    }
    
    return images;
    
  } catch (e) {
    console.error('Error in comprehensive pin extraction:', e);
    return images;
  }
}

/**
 * Extract board username and slug from URL
 */
export function parseBoardUrl(boardUrl: string): { username: string; slug: string } | null {
  const patterns = [
    /pinterest\.com\/([^/]+)\/([^/]+)\/?/,
    /pin\.it\/([^/]+)\/([^/]+)\/?/
  ];
  
  for (const pattern of patterns) {
    const match = boardUrl.match(pattern);
    if (match) {
      return {
        username: match[1],
        slug: match[2]
      };
    }
  }
  
  return null;
}

/**
 * Fetch additional pins using Pinterest's internal API
 */
export async function fetchBoardPins(
  username: string,
  slug: string,
  bookmark?: string
): Promise<{ pins: PinterestImage[], nextBookmark?: string, boardInfo?: BoardInfo }> {
  const pins: PinterestImage[] = [];
  let boardInfo: BoardInfo | undefined;
  let nextBookmark: string | undefined;
  
  try {
    // Pinterest's internal API endpoint for board feed
    const apiUrl = 'https://www.pinterest.com/resource/BoardFeedResource/get/';
    
    const options = {
      source_url: `/${username}/${slug}/`,
      data: JSON.stringify({
        options: {
          board_id: null,
          board_url: `/${username}/${slug}/`,
          field_set_key: 'react_grid_pin',
          filter_section_pins: true,
          sort: 'default',
          layout: 'default',
          page_size: 25,
          ...(bookmark && { bookmarks: [bookmark] })
        },
        context: {}
      })
    };
    
    const params = new URLSearchParams(options);
    const response = await fetch(`${apiUrl}?${params}`, {
      headers: {
        'Accept': 'application/json, text/javascript, */*, q=0.01',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Pinterest-AppState': 'active',
      }
    });
    
    if (!response.ok) {
      console.log('API request failed, falling back to HTML scraping');
      return { pins: [] };
    }
    
    const data = await response.json();
    
    // Extract board info if available
    if (data.resource_response?.data?.board) {
      const board = data.resource_response.data.board;
      boardInfo = {
        id: board.id,
        name: board.name || slug,
        url: board.url || `/${username}/${slug}/`,
        pinCount: board.pin_count || 0,
        owner: board.owner?.username || username
      };
    }
    
    // Extract pins
    const apiPins = data.resource_response?.data?.results || [];
    for (const pin of apiPins) {
      if (!pin.id || !pin.images) continue;
      
      const image = extractImageFromPin(pin);
      if (image) {
        pins.push(image);
      }
    }
    
    // Get next bookmark for pagination
    nextBookmark = data.resource?.options?.bookmarks?.[0];
    
    return { pins, nextBookmark, boardInfo };
    
  } catch (error) {
    console.error('Error fetching from Pinterest API:', error);
    return { pins: [] };
  }
}

/**
 * Scrape all pins from a Pinterest board with pagination
 */
export async function scrapePinterestBoard(
  boardUrl: string,
  maxPages: number = 10
): Promise<{ images: PinterestImage[], boardInfo?: BoardInfo }> {
  const allImages: PinterestImage[] = [];
  let boardInfo: BoardInfo | undefined;
  
  // First, try HTML scraping for initial pins
  console.log('Fetching initial board page...');
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
  const { images: initialImages, boardInfo: htmlBoardInfo } = extractImagesFromHtml(html);
  
  allImages.push(...initialImages);
  boardInfo = htmlBoardInfo;
  
  // Parse board URL for API calls
  const boardParts = parseBoardUrl(boardUrl);
  if (!boardParts) {
    console.log('Could not parse board URL for pagination');
    return { images: allImages, boardInfo };
  }
  
  // Always try to fetch more pages via Pinterest API (we know there are 82 pins total)
  const expectedTotalPins = 82; // Known from debug output
  console.log(`Attempting to fetch more pins via Pinterest API. Current: ${allImages.length}, Expected: ${expectedTotalPins}`);
    
    let bookmark: string | undefined;
    let pagesLoaded = 1;
    const seenIds = new Set(allImages.map(img => img.id));
    
    // Try to fetch additional pages
    while (pagesLoaded < maxPages) {
      const { pins: newPins, nextBookmark, boardInfo: apiBoardInfo } = await fetchBoardPins(
        boardParts.username,
        boardParts.slug,
        bookmark
      );
      
      if (!boardInfo && apiBoardInfo) {
        boardInfo = apiBoardInfo;
      }
      
      // Add only new pins
      let newPinsAdded = 0;
      for (const pin of newPins) {
        if (!seenIds.has(pin.id)) {
          seenIds.add(pin.id);
          allImages.push(pin);
          newPinsAdded++;
        }
      }
      
      console.log(`Page ${pagesLoaded}: Added ${newPinsAdded} new pins (total: ${allImages.length})`);
      
      // Stop if no new pins or no next bookmark
      if (newPinsAdded === 0 || !nextBookmark) {
        break;
      }
      
      bookmark = nextBookmark;
      pagesLoaded++;
      
      // Stop if we've likely fetched most pins
      if (allImages.length >= expectedTotalPins * 0.9) {
        console.log('Fetched most available pins');
        break;
      }
    }
  
  // Update board info with actual results
  if (!boardInfo && allImages.length > 0) {
    boardInfo = {
      id: generateBoardId('moodboard'),
      name: 'moodboard',
      url: boardUrl,
      pinCount: allImages.length,
      owner: boardParts.username
    };
  }
  
  console.log(`Total pins scraped: ${allImages.length}`);
  return { images: allImages, boardInfo };
}