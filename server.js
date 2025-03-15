const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));

// Routes
app.post('/api/extract', async (req, res) => {
    try {
        const { url, platform } = req.body;
        
        if (!url || !platform) {
            return res.status(400).json({ error: 'URL and platform are required' });
        }
        
        let playlistData;
        
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
        
        res.json(playlistData);
    } catch (error) {
        console.error('Extraction error:', error);
        res.status(500).json({ error: 'Failed to extract playlist data: ' + error.message });
    }
});

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
        // Extract the playlist ID from the URL
        const playlistId = extractNeteaseMusicPlaylistId(url);
        if (!playlistId) {
            throw new Error('Invalid Netease Music playlist URL');
        }
        
        // Netease Music API endpoint
        const apiUrl = `https://music.163.com/api/playlist/detail?id=${playlistId}`;
        
        // Make request to the API
        const response = await axios.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://music.163.com/'
            }
        });
        
        const data = response.data;
        if (!data.result || !data.result.tracks) {
            throw new Error('No playlist data returned from Netease Music');
        }
        
        const playlistInfo = {
            title: data.result.name || 'Unknown Playlist',
            creator: data.result.creator ? data.result.creator.nickname : 'Unknown Creator',
            songCount: data.result.trackCount || data.result.tracks.length
        };
        
        const songs = data.result.tracks.map((track, index) => {
            return {
                id: index + 1,
                title: track.name,
                artist: track.artists.map(artist => artist.name).join(', '),
                album: track.album ? track.album.name : '',
                duration: formatDuration(track.duration)
            };
        });
        
        return { playlistInfo, songs };
    } catch (error) {
        console.error('Error extracting Netease Music playlist:', error);
        
        // Fallback to web scraping if API fails
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            
            const $ = cheerio.load(response.data);
            
            const title = $('h2.f-ff2').text().trim() || 'Unknown Playlist';
            const creator = $('div.user a.s-fc7').text().trim() || 'Unknown Creator';
            
            const songs = [];
            $('ul.f-hide li a').each((index, element) => {
                const songTitle = $(element).text().trim();
                
                if (songTitle) {
                    songs.push({
                        id: index + 1,
                        title: songTitle,
                        artist: 'Unknown Artist', // Basic scraping might not get all details
                        album: 'Unknown Album',
                        duration: '0:00'
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
            throw new Error('Failed to extract Netease Music playlist: ' + error.message);
        }
    }
}

// Helper function to extract Netease Music playlist ID
function extractNeteaseMusicPlaylistId(url) {
    try {
        const regex = /playlist\?id=(\d+)/;
        const match = url.match(regex);
        return match ? match[1] : null;
    } catch (error) {
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
}); 