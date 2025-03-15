const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration - more permissive for development
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware for parsing JSON
app.use(express.json());

// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));

// Routes - add a basic test route
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working' });
});

// Extraction API endpoint
app.post('/api/extract', async (req, res) => {
    try {
        console.log('Received extraction request:', req.body);
        const { url, platform } = req.body;
        
        if (!url || !platform) {
            return res.status(400).json({ error: 'URL and platform are required' });
        }
        
        let playlistData;
        
        // For real extraction - uncomment this section and remove the mock data section
        try {
            console.log(`Extracting playlist for platform: ${platform}`);
            
            switch (platform) {
                case 'apple':
                    playlistData = await extractAppleMusicPlaylist(url);
                    break;
                case 'netease':
                    playlistData = await extractNeteaseMusicPlaylist(url);
                    break;
                case 'qq':
                    playlistData = await extractQQMusicPlaylist(url);
                    break;
                default:
                    return res.status(400).json({ error: 'Unsupported platform' });
            }
            
            console.log(`Successfully extracted playlist with ${playlistData.songs.length} songs`);
            
            // Set a flag to indicate if this is mock data (for UI feedback)
            if (playlistData.playlistInfo && playlistData.playlistInfo.extractionStatus === 'mock_data') {
                console.log('Note: Returning mock data as extraction failed');
            }
            
            res.json(playlistData);
        } catch (error) {
            console.error(`Error during ${platform} extraction:`, error);
            
            // Fallback to mock data on error
            console.log(`Falling back to mock data for ${platform}`);
            playlistData = getMockData(platform);
            
            // Add a note that this is mock data due to extraction failure
            playlistData.playlistInfo.note = `Mock data: ${error.message}`;
            playlistData.playlistInfo.extractionStatus = 'mock_data';
            
            res.json(playlistData);
        }
    } catch (error) {
        console.error('Fatal extraction error:', error);
        res.status(500).json({ error: 'Failed to extract playlist data: ' + error.message });
    }
});

// Function to get mock data for testing
function getMockData(platform) {
    const platformName = platform === 'apple' ? 'Apple Music' : 
                          platform === 'netease' ? 'Netease Music' : 'QQ Music';
    
    return {
        playlistInfo: {
            title: `${platformName} Test Playlist`,
            creator: 'Test User',
            songCount: 5
        },
        songs: [
            { id: 1, title: 'Test Song 1', artist: 'Test Artist 1', album: 'Test Album 1', duration: '3:45' },
            { id: 2, title: 'Test Song 2', artist: 'Test Artist 2', album: 'Test Album 2', duration: '4:12' },
            { id: 3, title: 'Test Song 3', artist: 'Test Artist 3', album: 'Test Album 3', duration: '3:21' },
            { id: 4, title: 'Test Song 4', artist: 'Test Artist 4', album: 'Test Album 4', duration: '2:55' },
            { id: 5, title: 'Test Song 5', artist: 'Test Artist 5', album: 'Test Album 5', duration: '5:07' }
        ]
    };
}

// Apple Music extraction
async function extractAppleMusicPlaylist(url) {
    try {
        // Extract the playlist ID from the URL
        const playlistId = extractAppleMusicPlaylistId(url);
        if (!playlistId) {
            throw new Error('Invalid Apple Music playlist URL');
        }
        
        // Make a request to fetch the playlist page
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        // Load the HTML into cheerio
        const $ = cheerio.load(response.data);
        
        // Extract playlist information
        const title = $('meta[property="og:title"]').attr('content') || 'Unknown Playlist';
        const creator = $('.product-creator').text().trim() || 'Unknown Creator';
        
        // Extract songs
        const songs = [];
        $('.songs-list-row').each((index, element) => {
            const songTitle = $(element).find('.songs-list-row__song-name').text().trim();
            const artist = $(element).find('.songs-list-row__by-line').text().trim();
            const album = $(element).find('.songs-list-row__album-name').text().trim();
            const duration = $(element).find('.songs-list-row__length').text().trim();
            
            if (songTitle) {
                songs.push({
                    id: index + 1,
                    title: songTitle,
                    artist: artist,
                    album: album,
                    duration: duration
                });
            }
        });
        
        return {
            playlistInfo: {
                title: title,
                creator: creator,
                songCount: songs.length
            },
            songs: songs
        };
    } catch (error) {
        console.error('Error extracting Apple Music playlist:', error);
        throw new Error('Failed to extract Apple Music playlist: ' + error.message);
    }
}

// Helper function to extract Apple Music playlist ID
function extractAppleMusicPlaylistId(url) {
    try {
        const regex = /playlist\/[^/]+\/([^?]+)/;
        const match = url.match(regex);
        return match ? match[1] : null;
    } catch (error) {
        return null;
    }
}

// Netease Music extraction
async function extractNeteaseMusicPlaylist(url) {
    try {
        console.log('Attempting to extract Netease Music playlist from URL:', url);
        
        // Extract the playlist ID from the URL
        const playlistId = extractNeteaseMusicPlaylistId(url);
        if (!playlistId) {
            console.log('Invalid Netease Music playlist URL - could not extract ID');
            throw new Error('Invalid Netease Music playlist URL');
        }
        
        console.log('Extracted Netease playlist ID:', playlistId);
        
        // First try with API endpoint
        try {
            // Netease Music API endpoint
            const apiUrl = `https://music.163.com/api/playlist/detail?id=${playlistId}`;
            console.log('Attempting API request to:', apiUrl);
            
            // Make request to the API with more detailed headers
            const response = await axios.get(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': 'https://music.163.com/',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Origin': 'https://music.163.com',
                    'Connection': 'keep-alive'
                },
                timeout: 10000 // 10 second timeout
            });
            
            console.log('API response status:', response.status);
            console.log('API response headers:', response.headers);
            
            // Log a sample of the response data for debugging
            const responseData = response.data;
            console.log('API response sample:', JSON.stringify(responseData).substring(0, 500) + '...');
            
            if (!responseData.result || !responseData.result.tracks) {
                console.log('API response missing expected structure, falling back to web scraping');
                throw new Error('No playlist data structure in API response');
            }
            
            const playlistInfo = {
                title: responseData.result.name || 'Unknown Playlist',
                creator: responseData.result.creator ? responseData.result.creator.nickname : 'Unknown Creator',
                songCount: responseData.result.trackCount || responseData.result.tracks.length
            };
            
            const songs = responseData.result.tracks.map((track, index) => {
                return {
                    id: index + 1,
                    title: track.name || 'Unknown Title',
                    artist: track.artists ? track.artists.map(artist => artist.name).join(', ') : 'Unknown Artist',
                    album: track.album ? track.album.name : 'Unknown Album',
                    duration: formatDuration(track.duration || 0)
                };
            });
            
            console.log(`Successfully extracted ${songs.length} songs via API`);
            return { playlistInfo, songs };
            
        } catch (apiError) {
            // Log API error and fall back to web scraping
            console.error('API extraction failed, error:', apiError.message);
            console.log('Falling back to web scraping approach');
            
            // Construct web URL from playlist ID
            const webUrl = `https://music.163.com/#/playlist?id=${playlistId}`;
            console.log('Attempting web scraping from:', webUrl);
            
            const response = await axios.get(webUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://music.163.com/',
                    'Upgrade-Insecure-Requests': '1'
                }
            });
            
            console.log('Web response status:', response.status);
            
            // Check if the response contains iframes or redirects
            if (response.data.includes('iframe') || response.data.includes('http-equiv="refresh"')) {
                console.log('Web page contains frames or redirects, may need a headless browser approach');
            }
            
            const $ = cheerio.load(response.data);
            
            // Use multiple selectors to try to find playlist title
            const title = $('h2.f-ff2').text().trim() || 
                          $('.f-ff2').text().trim() || 
                          $('title').text().replace(' - 网易云音乐', '').trim() || 
                          'Netease Music Playlist';
                          
            // Get creator info if available
            const creator = $('div.user a.s-fc7').text().trim() || 
                           $('.user a').text().trim() || 
                           'Netease User';
            
            console.log('Extracted playlist info via scraping:', { title, creator });
            
            // Try multiple selectors for song list
            const songs = [];
            
            // First attempt: standard list
            $('ul.f-hide li a').each((index, element) => {
                const songTitle = $(element).text().trim();
                if (songTitle) {
                    songs.push({
                        id: index + 1,
                        title: songTitle,
                        artist: 'Unknown Artist',
                        album: 'Unknown Album',
                        duration: '0:00'
                    });
                }
            });
            
            // Second attempt: table format
            if (songs.length === 0) {
                $('.m-table tbody tr').each((index, element) => {
                    const songTitle = $(element).find('.txt a').text().trim();
                    const artist = $(element).find('.text a').text().trim() || 'Unknown Artist';
                    
                    if (songTitle) {
                        songs.push({
                            id: index + 1,
                            title: songTitle,
                            artist: artist,
                            album: 'Unknown Album',
                            duration: '0:00'
                        });
                    }
                });
            }
            
            // If still no songs, use mock data as last resort
            if (songs.length === 0) {
                console.log('Failed to extract songs via scraping, using mock data');
                // Use playlistId in mock data to show we at least got the ID
                return getMockNeaseData(playlistId);
            }
            
            console.log(`Successfully extracted ${songs.length} songs via web scraping`);
            
            return {
                playlistInfo: {
                    title: title,
                    creator: creator,
                    songCount: songs.length
                },
                songs: songs
            };
        }
    } catch (error) {
        console.error('Error extracting Netease Music playlist:', error);
        // Return mock data as a last resort
        return getMockNeaseData();
    }
}

// Function to get mock Netease data when everything else fails
function getMockNeaseData(playlistId = 'unknown') {
    return {
        playlistInfo: {
            title: `Netease Music Playlist ${playlistId}`,
            creator: 'Netease User',
            songCount: 5,
            note: 'This is mock data. The actual playlist extraction failed.',
            extractionStatus: 'mock_data'
        },
        songs: [
            { id: 1, title: 'Netease Song 1', artist: 'Netease Artist 1', album: 'Netease Album 1', duration: '3:45' },
            { id: 2, title: 'Netease Song 2', artist: 'Netease Artist 2', album: 'Netease Album 2', duration: '4:12' },
            { id: 3, title: 'Netease Song 3', artist: 'Netease Artist 3', album: 'Netease Album 3', duration: '3:21' },
            { id: 4, title: 'Netease Song 4', artist: 'Netease Artist 4', album: 'Netease Album 4', duration: '2:55' },
            { id: 5, title: 'Netease Song 5', artist: 'Netease Artist 5', album: 'Netease Album 5', duration: '5:07' }
        ]
    };
}

// Helper function to extract Netease Music playlist ID - update to handle more URL formats
function extractNeteaseMusicPlaylistId(url) {
    try {
        // Handle multiple URL formats
        let playlistId = null;
        
        // Format: https://music.163.com/#/playlist?id=123456
        const standardRegex = /playlist\?id=(\d+)/;
        const match = url.match(standardRegex);
        if (match) {
            playlistId = match[1];
        }
        
        // Format: https://music.163.com/playlist/123456/share
        if (!playlistId) {
            const alternateRegex = /playlist\/(\d+)/;
            const altMatch = url.match(alternateRegex);
            if (altMatch) {
                playlistId = altMatch[1];
            }
        }
        
        // Format: music.163.com/#/m/playlist?id=123456
        if (!playlistId) {
            const mobileRegex = /m\/playlist\?id=(\d+)/;
            const mobileMatch = url.match(mobileRegex);
            if (mobileMatch) {
                playlistId = mobileMatch[1];
            }
        }
        
        return playlistId;
    } catch (error) {
        console.error('Error extracting Netease playlist ID:', error);
        return null;
    }
}

// QQ Music extraction
async function extractQQMusicPlaylist(url) {
    try {
        // Extract the playlist ID from the URL
        const playlistId = extractQQMusicPlaylistId(url);
        if (!playlistId) {
            throw new Error('Invalid QQ Music playlist URL');
        }
        
        // QQ Music uses multiple APIs for different parts of playlist data
        const playlistInfoUrl = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${playlistId}&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`;
        
        // Make request with proper headers to avoid CSRF protection
        const response = await axios.get(playlistInfoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://y.qq.com/n/yqq/playlist/' + playlistId + '.html'
            }
        });
        
        const data = response.data;
        if (!data.cdlist || !data.cdlist[0]) {
            throw new Error('No playlist data returned from QQ Music');
        }
        
        const playlistData = data.cdlist[0];
        
        const playlistInfo = {
            title: playlistData.dissname || 'Unknown Playlist',
            creator: playlistData.nickname || 'Unknown Creator',
            songCount: playlistData.songnum || playlistData.songlist.length
        };
        
        const songs = playlistData.songlist.map((song, index) => {
            return {
                id: index + 1,
                title: song.songname || 'Unknown Title',
                artist: song.singer ? song.singer.map(s => s.name).join(', ') : 'Unknown Artist',
                album: song.albumname || 'Unknown Album',
                duration: formatDuration(song.interval * 1000) // Convert seconds to milliseconds
            };
        });
        
        return { playlistInfo, songs };
    } catch (error) {
        console.error('Error extracting QQ Music playlist:', error);
        
        // Fallback to web scraping if API fails
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            
            const $ = cheerio.load(response.data);
            
            const title = $('.data__name_txt').text().trim() || 'Unknown Playlist';
            const creator = $('.data__author a').text().trim() || 'Unknown Creator';
            
            const songs = [];
            $('.songlist__list .songlist__item').each((index, element) => {
                const songTitle = $(element).find('.songlist__songname_txt').text().trim();
                const artist = $(element).find('.songlist__artist').text().trim();
                const album = $(element).find('.songlist__album').text().trim();
                const duration = $(element).find('.songlist__time').text().trim();
                
                if (songTitle) {
                    songs.push({
                        id: index + 1,
                        title: songTitle,
                        artist: artist,
                        album: album,
                        duration: duration
                    });
                }
            });
            
            return {
                playlistInfo: {
                    title: title,
                    creator: creator,
                    songCount: songs.length
                },
                songs: songs
            };
        } catch (scrapingError) {
            throw new Error('Failed to extract QQ Music playlist: ' + error.message);
        }
    }
}

// Helper function to extract QQ Music playlist ID
function extractQQMusicPlaylistId(url) {
    try {
        const regex = /playlist\/([^.]+)/;
        const match = url.match(regex);
        return match ? match[1] : null;
    } catch (error) {
        return null;
    }
}

// Helper function to format duration from milliseconds
function formatDuration(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
}

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access the application at http://localhost:${PORT}`);
}); 