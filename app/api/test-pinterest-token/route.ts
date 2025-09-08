import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const accessToken = process.env.PINTEREST_ACCESS_TOKEN;
    
    if (!accessToken || accessToken === 'your_access_token_here') {
      return NextResponse.json({
        error: 'Pinterest access token not configured',
        instructions: 'Please set PINTEREST_ACCESS_TOKEN in .env.local file'
      }, { status: 400 });
    }

    console.log('Testing Pinterest API v5 authentication...');

    // Test 1: Get user info (verify token is valid)
    // Try multiple authentication approaches based on Pinterest API documentation
    console.log('Attempting Pinterest API v5 authentication with multiple methods...');
    
    // Method 1: Bearer token in Authorization header
    let userResponse = await fetch('https://api.pinterest.com/v5/user_account', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Pinterest-Scraper/1.0)'
      }
    });

    // Method 2: If Bearer fails, try access_token parameter
    if (!userResponse.ok) {
      console.log('Bearer token failed, trying access_token parameter...');
      userResponse = await fetch(`https://api.pinterest.com/v5/user_account?access_token=${accessToken}`, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; Pinterest-Scraper/1.0)'
        }
      });
    }

    // Method 3: If v5 fails, try Pinterest API v3 (legacy)
    if (!userResponse.ok) {
      console.log('API v5 failed, trying v3...');
      userResponse = await fetch(`https://api.pinterest.com/v3/users/me/?access_token=${accessToken}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; Pinterest-Scraper/1.0)'
        }
      });
    }

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.log('All authentication methods failed:', errorText);
      
      return NextResponse.json({
        error: 'Pinterest API authentication failed with all methods',
        attempts: [
          'v5 with Bearer token',
          'v5 with access_token parameter', 
          'v3 legacy API'
        ],
        status: userResponse.status,
        statusText: userResponse.statusText,
        details: errorText,
        instructions: [
          'Check if your Pinterest access token is valid and not expired',
          'Verify token was generated with correct scopes (boards:read, pins:read)',
          'Try regenerating your access token from Pinterest Developer Console',
          'Ensure your Pinterest app has the required permissions'
        ]
      }, { status: 401 });
    }

    const userData = await userResponse.json();
    console.log('✅ Pinterest API authentication successful!');

    // Test 2: Get user's boards to find the target board
    const boardsResponse = await fetch('https://api.pinterest.com/v5/boards', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'User-Agent': 'Pinterest-Scraper/1.0'
      }
    });

    let boards = [];
    let moodboard = null;

    if (boardsResponse.ok) {
      const boardsData = await boardsResponse.json();
      boards = boardsData.items || [];
      
      // Find the moodboard
      moodboard = boards.find((board: any) => 
        board.name?.toLowerCase().includes('moodboard') ||
        board.id?.includes('moodboard')
      );
      
      console.log(`Found ${boards.length} boards, moodboard:`, moodboard ? 'Found' : 'Not found');
    }

    // Test 3: If we have moodboard, test getting pins from it
    let pinsTest = null;
    if (moodboard) {
      const pinsResponse = await fetch(
        `https://api.pinterest.com/v5/boards/${moodboard.id}/pins?page_size=10`, 
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'User-Agent': 'Pinterest-Scraper/1.0'
          }
        }
      );

      if (pinsResponse.ok) {
        const pinsData = await pinsResponse.json();
        pinsTest = {
          totalPins: pinsData.items?.length || 0,
          hasMorePages: !!pinsData.bookmark,
          samplePin: pinsData.items?.[0]?.id || null
        };
        console.log(`✅ Successfully fetched ${pinsTest.totalPins} pins from moodboard`);
      }
    }

    return NextResponse.json({
      success: true,
      message: '✅ Pinterest API v5 authentication successful!',
      tokenValid: true,
      user: {
        id: userData.id,
        username: userData.username,
        account_type: userData.account_type
      },
      boards: {
        total: boards.length,
        moodboard: moodboard ? {
          id: moodboard.id,
          name: moodboard.name,
          pin_count: moodboard.pin_count
        } : null
      },
      pinsTest,
      nextSteps: [
        'Token authentication working ✅',
        moodboard ? `Found moodboard: ${moodboard.name} (${moodboard.pin_count} pins)` : 'No moodboard found - will use board URL parsing',
        'Ready to integrate with main scraper for complete pin extraction'
      ]
    });

  } catch (error) {
    console.error('Pinterest API test error:', error);
    return NextResponse.json({
      error: 'Pinterest API test failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      instructions: 'Please check your Pinterest access token and network connection'
    }, { status: 500 });
  }
}