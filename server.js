const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Apple Music开发者信息配置
// 在实际部署时，这些应该从环境变量加载
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || 'YOUR_TEAM_ID';
const APPLE_KEY_ID = process.env.APPLE_KEY_ID || 'YOUR_KEY_ID';
const APPLE_PRIVATE_KEY_PATH = process.env.APPLE_PRIVATE_KEY_PATH || path.join(__dirname, 'apple_private_key.p8');

// 存储每个客户端的提取进度
const extractionProgress = new Map();

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

// Progress endpoint using Server-Sent Events (SSE)
app.get('/api/progress/:requestId', (req, res) => {
    const requestId = req.params.requestId;
    
    // 设置SSE头部
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // 初始化进度为0
    if (!extractionProgress.has(requestId)) {
        extractionProgress.set(requestId, {
            status: 'initializing',
            progress: 0,
            message: 'Initializing extraction process...',
            total: 0,
            current: 0
        });
    }
    
    // 发送初始进度
    const sendProgress = () => {
        const progress = extractionProgress.get(requestId) || {
            status: 'unknown',
            progress: 0,
            message: 'No progress data available'
        };
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
    };
    
    // 立即发送一次当前进度
    sendProgress();
    
    // 每秒发送一次更新
    const intervalId = setInterval(sendProgress, 1000);
    
    // 当连接关闭时清除interval
    req.on('close', () => {
        clearInterval(intervalId);
        console.log(`SSE connection closed for request ID: ${requestId}`);
    });
});

// 更新进度的函数
function updateProgress(requestId, data) {
    if (extractionProgress.has(requestId)) {
        const progress = extractionProgress.get(requestId);
        extractionProgress.set(requestId, { ...progress, ...data });
    } else {
        extractionProgress.set(requestId, data);
    }
}

// 添加Apple Music开发者令牌生成函数
function generateAppleMusicToken() {
    try {
        // 检查是否配置了必要的信息
        if (!APPLE_TEAM_ID || APPLE_TEAM_ID === 'YOUR_TEAM_ID' || 
            !APPLE_KEY_ID || APPLE_KEY_ID === 'YOUR_KEY_ID') {
            console.log('Apple Music developer credentials not configured properly');
            return null;
        }
        
        // 检查私钥文件是否存在
        if (!fs.existsSync(APPLE_PRIVATE_KEY_PATH)) {
            console.error('Apple Music private key file not found at:', APPLE_PRIVATE_KEY_PATH);
            return null;
        }
        
        const privateKey = fs.readFileSync(APPLE_PRIVATE_KEY_PATH, 'utf8');
        const token = jwt.sign({}, privateKey, {
            algorithm: 'ES256',
            expiresIn: '180d', // 6个月有效期
            issuer: APPLE_TEAM_ID,
            header: {
                alg: 'ES256',
                kid: APPLE_KEY_ID
            }
        });
        
        console.log('Apple Music developer token generated successfully');
        return token;
    } catch (error) {
        console.error('Error generating Apple Music token:', error);
        return null;
    }
}

// 添加Apple Music授权API端点
app.post('/api/apple-music/auth', (req, res) => {
    try {
        // 检查是否配置了必要的信息
        if (!APPLE_TEAM_ID || APPLE_TEAM_ID === 'YOUR_TEAM_ID' || 
            !APPLE_KEY_ID || APPLE_KEY_ID === 'YOUR_KEY_ID') {
            // 返回一个提示信息，但不作为错误，这样前端仍然可以尝试非授权模式
            return res.json({
                developerToken: null,
                message: 'Apple Music developer credentials not configured properly. Using non-authenticated mode.'
            });
        }
        
        const token = generateAppleMusicToken();
        if (token) {
            res.json({ developerToken: token });
        } else {
            res.status(500).json({ error: 'Failed to generate Apple Music developer token' });
        }
    } catch (error) {
        console.error('Error in Apple Music auth endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Extraction API endpoint
app.post('/api/extract', async (req, res) => {
    try {
        const { url, platform, requestId, userToken } = req.body;
        
        if (!url || !platform) {
            return res.status(400).json({ error: 'URL and platform are required' });
        }
        
        console.log(`Received extraction request for ${platform} playlist: ${url}`);
        
        // 初始化进度
        updateProgress(requestId, {
            status: 'initializing',
            progress: 0,
            message: '正在初始化提取过程...',
            current: 0,
            total: 10
        });
        
        let result;
        
        // 根据平台调用相应的提取函数
        switch (platform) {
            case 'apple':
                // 优先使用用户令牌
                if (userToken) {
                    console.log('Using user token for Apple Music extraction');
                    updateProgress(requestId, {
                        progress: 5,
                        message: '使用授权模式提取Apple Music歌单...',
                        current: 1,
                        total: 10
                    });
                }
                result = await extractAppleMusicPlaylist(url, requestId, userToken);
                break;
            case 'netease':
                result = await extractNeteaseMusicPlaylist(url, requestId);
                break;
            case 'qq':
                result = await extractQQMusicPlaylist(url, requestId);
                break;
            default:
                return res.status(400).json({ error: 'Unsupported platform' });
        }
        
        res.json(result);
    } catch (error) {
        console.error('Error in extraction API:', error);
        res.status(500).json({ error: error.message });
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
async function extractAppleMusicPlaylist(url, requestId = null, userToken = null) {
    try {
        console.log('Attempting to extract Apple Music playlist from URL:', url);
        
        // 更新进度 - 开始提取
        if (requestId) {
            updateProgress(requestId, {
                status: 'extracting',
                progress: 5,
                message: '正在提取Apple Music歌单ID...',
                current: 1,
                total: 10
            });
        }
        
        // Extract the playlist ID from the URL
        const playlistId = extractAppleMusicPlaylistId(url);
        if (!playlistId) {
            console.log('Invalid Apple Music playlist URL - could not extract ID');
            throw new Error('Invalid Apple Music playlist URL');
        }
        
        console.log('Extracted Apple Music playlist ID:', playlistId);
        
        // 更新进度 - 已提取ID
        if (requestId) {
            updateProgress(requestId, {
                progress: 10,
                message: `成功提取歌单ID: ${playlistId}，正在获取歌单数据...`,
                current: 2,
                total: 10
            });
        }
        
        // 如果提供了用户令牌，尝试使用用户登录方式获取数据
        if (userToken) {
            try {
                console.log('使用用户登录方式获取歌单数据');
                
                // 更新进度
                if (requestId) {
                    updateProgress(requestId, {
                        progress: 40,
                        message: '使用Apple Music用户登录获取歌单数据...',
                        current: 4,
                        total: 10
                    });
                }
                
                // 使用用户登录方式，我们可以尝试通过网页抓取获取更多数据
                // 因为用户已登录，可能会显示更多内容
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Cache-Control': 'max-age=0',
                        'Cookie': `music_user_token=${userToken}`  // 尝试使用用户令牌作为Cookie
                    }
                });
                
                console.log('User authenticated response status:', response.status);
                
                // 使用Cheerio解析HTML
                const $ = cheerio.load(response.data);
                
                // 提取歌单信息
                const title = $('meta[property="og:title"]').attr('content') || 
                             $('.product-header__title').text().trim() ||
                             $('h1.headings__title').text().trim() ||
                             'Unknown Playlist';
                             
                const creator = $('.product-creator').text().trim() || 
                               $('.product-header__identity a').text().trim() ||
                               $('.headings__subtitles a').text().trim() ||
                               'Unknown Creator';
                
                console.log('Extracted playlist info with user auth:', { title, creator });
                
                // 尝试提取歌曲信息
                let songs = [];
                
                // 尝试多种选择器
                const selectors = [
                    '.songs-list-row', '.tracklist-item', '.track',
                    'tr', 'li', '.song-row', 'div[role="row"]'
                ];
                
                for (const selector of selectors) {
                    $(selector).each((index, element) => {
                        const text = $(element).text().trim();
                        
                        // 检查是否包含时长格式
                        if (text.match(/\d+:\d+/)) {
                            // 尝试提取信息
                            let songTitle = '';
                            let artist = '';
                            let album = '';
                            let duration = '';
                            
                            // 尝试从子元素中提取
                            const cells = $(element).find('td, div, span').filter(function() {
                                return $(this).text().trim().length > 0;
                            });
                            
                            if (cells.length >= 2) {
                                // 假设第一个单元格是标题，第二个是艺术家
                                songTitle = $(cells[0]).text().trim();
                                artist = $(cells[1]).text().trim();
                                
                                // 如果有更多单元格，可能包含专辑和时长
                                if (cells.length >= 3) {
                                    album = $(cells[2]).text().trim();
                                }
                                
                                // 查找时长 - 通常是最后一个单元格，格式为 MM:SS
                                for (let j = cells.length - 1; j >= 0; j--) {
                                    const cellText = $(cells[j]).text().trim();
                                    if (cellText.match(/^\d+:\d+$/)) {
                                        duration = cellText;
                                        break;
                                    }
                                }
                            } else {
                                // 如果没有明确的单元格，尝试从文本中提取
                                const durationMatch = text.match(/(\d+:\d+)/);
                                if (durationMatch) {
                                    duration = durationMatch[1];
                                    
                                    // 移除时长，剩下的可能是标题和艺术家
                                    const remainingText = text.replace(durationMatch[1], '').trim();
                                    const parts = remainingText.split(/[-–•]/);
                                    
                                    if (parts.length >= 2) {
                                        songTitle = parts[0].trim();
                                        artist = parts[1].trim();
                                    } else {
                                        songTitle = remainingText;
                                    }
                                }
                            }
                            
                            // 如果找到了标题，添加到歌曲列表
                            if (songTitle && songTitle.length > 1) {
                                songs.push({
                                    id: songs.length + 1,
                                    title: songTitle,
                                    artist: artist || 'Unknown Artist',
                                    album: album || 'Unknown Album',
                                    duration: duration || '0:00'
                                });
                            }
                        }
                    });
                    
                    // 如果找到了足够的歌曲，停止尝试其他选择器
                    if (songs.length > 5) break;
                }
                
                // 如果找到了歌曲，返回结果
                if (songs.length > 0) {
                    console.log(`Successfully extracted ${songs.length} songs with user authentication`);
                    
                    // 更新进度 - 完成
                    if (requestId) {
                        updateProgress(requestId, {
                            status: 'completed',
                            progress: 100,
                            message: `成功从"${title}"中提取了 ${songs.length} 首歌曲（已登录）`,
                            current: 10,
                            total: 10
                        });
                    }
                    
                    return {
                        playlistInfo: {
                            title: title,
                            creator: creator,
                            songCount: songs.length,
                            extractionStatus: 'authenticated_data'
                        },
                        songs: songs
                    };
                }
                
                // 如果没有找到歌曲，尝试从script标签中提取JSON数据
                console.log('Trying to extract JSON data from script tags with user auth');
                const scriptTags = $('script[type="application/json"], script:not([type])');
                
                for (let i = 0; i < scriptTags.length; i++) {
                    try {
                        const scriptContent = $(scriptTags[i]).html();
                        if (scriptContent && 
                           (scriptContent.includes('"kind":"playlist"') || 
                            scriptContent.includes('"type":"playlist"') || 
                            scriptContent.includes('"tracks":'))) {
                            
                            console.log(`Found potential JSON data in script tag ${i}`);
                            const jsonData = JSON.parse(scriptContent);
                            
                            // 尝试从JSON中提取歌曲信息
                            const jsonSongs = [];
                            
                            // 尝试不同的JSON结构
                            if (jsonData.data && jsonData.data.sections) {
                                jsonData.data.sections.forEach(section => {
                                    if (section.items) {
                                        section.items.forEach((item, idx) => {
                                            if (item.attributes) {
                                                jsonSongs.push({
                                                    id: idx + 1,
                                                    title: item.attributes.name || 'Unknown Title',
                                                    artist: item.attributes.artistName || 'Unknown Artist',
                                                    album: item.attributes.albumName || 'Unknown Album',
                                                    duration: formatDuration(item.attributes.durationInMillis || 0)
                                                });
                                            }
                                        });
                                    }
                                });
                            } else if (jsonData.tracks) {
                                jsonData.tracks.forEach((track, idx) => {
                                    jsonSongs.push({
                                        id: idx + 1,
                                        title: track.name || 'Unknown Title',
                                        artist: track.artistName || 'Unknown Artist',
                                        album: track.albumName || 'Unknown Album',
                                        duration: formatDuration(track.durationInMillis || 0)
                                    });
                                });
                            }
                            
                            if (jsonSongs.length > 0) {
                                console.log(`Successfully extracted ${jsonSongs.length} songs from JSON data with user auth`);
                                
                                // 更新进度 - 完成
                                if (requestId) {
                                    updateProgress(requestId, {
                                        status: 'completed',
                                        progress: 100,
                                        message: `成功从"${title}"中提取了 ${jsonSongs.length} 首歌曲（已登录）`,
                                        current: 10,
                                        total: 10
                                    });
                                }
                                
                                return {
                                    playlistInfo: {
                                        title: title,
                                        creator: creator,
                                        songCount: jsonSongs.length,
                                        extractionStatus: 'authenticated_data'
                                    },
                                    songs: jsonSongs
                                };
                            }
                        }
                    } catch (e) {
                        // 忽略解析错误，继续尝试下一个script标签
                    }
                }
            } catch (authError) {
                console.error('用户登录提取失败:', authError.message);
            }
        }
        
        // 如果用户登录方式失败或未提供用户令牌，尝试使用非授权方式
        console.log('Falling back to non-authenticated extraction methods');
        
        // 更新进度 - 尝试非授权方式
        if (requestId) {
            updateProgress(requestId, {
                progress: 50,
                message: '尝试使用非授权方式提取歌单数据...',
                current: 5,
                total: 10
            });
        }
        
        // 尝试使用网页抓取方式
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            
            console.log('Non-authenticated response status:', response.status);
            
            // 使用Cheerio解析HTML
            const $ = cheerio.load(response.data);
            
            // 提取歌单信息
            const title = $('meta[property="og:title"]').attr('content') || 
                         $('.product-header__title').text().trim() ||
                         $('h1.headings__title').text().trim() ||
                         'Unknown Playlist';
                         
            const creator = $('.product-creator').text().trim() || 
                           $('.product-header__identity a').text().trim() ||
                           $('.headings__subtitles a').text().trim() ||
                           'Unknown Creator';
            
            console.log('Extracted playlist info:', { title, creator });
            
            // 尝试提取歌曲信息
            let songs = [];
            
            // 尝试多种选择器
            const selectors = [
                '.songs-list-row', '.tracklist-item', '.track',
                'tr', 'li', '.song-row', 'div[role="row"]'
            ];
            
            for (const selector of selectors) {
                $(selector).each((index, element) => {
                    const text = $(element).text().trim();
                    
                    // 检查是否包含时长格式
                    if (text.match(/\d+:\d+/)) {
                        // 尝试提取信息
                        let songTitle = '';
                        let artist = '';
                        let album = '';
                        let duration = '';
                        
                        // 尝试从子元素中提取
                        const cells = $(element).find('td, div, span').filter(function() {
                            return $(this).text().trim().length > 0;
                        });
                        
                        if (cells.length >= 2) {
                            // 假设第一个单元格是标题，第二个是艺术家
                            songTitle = $(cells[0]).text().trim();
                            artist = $(cells[1]).text().trim();
                            
                            // 如果有更多单元格，可能包含专辑和时长
                            if (cells.length >= 3) {
                                album = $(cells[2]).text().trim();
                            }
                            
                            // 查找时长 - 通常是最后一个单元格，格式为 MM:SS
                            for (let j = cells.length - 1; j >= 0; j--) {
                                const cellText = $(cells[j]).text().trim();
                                if (cellText.match(/^\d+:\d+$/)) {
                                    duration = cellText;
                                    break;
                                }
                            }
                        } else {
                            // 如果没有明确的单元格，尝试从文本中提取
                            const durationMatch = text.match(/(\d+:\d+)/);
                            if (durationMatch) {
                                duration = durationMatch[1];
                                
                                // 移除时长，剩下的可能是标题和艺术家
                                const remainingText = text.replace(durationMatch[1], '').trim();
                                const parts = remainingText.split(/[-–•]/);
                                
                                if (parts.length >= 2) {
                                    songTitle = parts[0].trim();
                                    artist = parts[1].trim();
                                } else {
                                    songTitle = remainingText;
                                }
                            }
                        }
                        
                        // 如果找到了标题，添加到歌曲列表
                        if (songTitle && songTitle.length > 1) {
                            songs.push({
                                id: songs.length + 1,
                                title: songTitle,
                                artist: artist || 'Unknown Artist',
                                album: album || 'Unknown Album',
                                duration: duration || '0:00'
                            });
                        }
                    }
                });
                
                // 如果找到了足够的歌曲，停止尝试其他选择器
                if (songs.length > 5) break;
            }
            
            // 如果找到了歌曲，返回结果
            if (songs.length > 0) {
                console.log(`Successfully extracted ${songs.length} songs`);
                
                // 更新进度 - 完成
                if (requestId) {
                    updateProgress(requestId, {
                        status: 'completed',
                        progress: 100,
                        message: `成功从"${title}"中提取了 ${songs.length} 首歌曲`,
                        current: 10,
                        total: 10
                    });
                }
                
                return {
                    playlistInfo: {
                        title: title,
                        creator: creator,
                        songCount: songs.length
                    },
                    songs: songs
                };
            }
            
            // 如果没有找到歌曲，尝试从script标签中提取JSON数据
            console.log('Trying to extract JSON data from script tags');
            const scriptTags = $('script[type="application/json"], script:not([type])');
            
            for (let i = 0; i < scriptTags.length; i++) {
                try {
                    const scriptContent = $(scriptTags[i]).html();
                    if (scriptContent && 
                       (scriptContent.includes('"kind":"playlist"') || 
                        scriptContent.includes('"type":"playlist"') || 
                        scriptContent.includes('"tracks":'))) {
                        
                        console.log(`Found potential JSON data in script tag ${i}`);
                        const jsonData = JSON.parse(scriptContent);
                        
                        // 尝试从JSON中提取歌曲信息
                        const jsonSongs = [];
                        
                        // 尝试不同的JSON结构
                        if (jsonData.data && jsonData.data.sections) {
                            jsonData.data.sections.forEach(section => {
                                if (section.items) {
                                    section.items.forEach((item, idx) => {
                                        if (item.attributes) {
                                            jsonSongs.push({
                                                id: idx + 1,
                                                title: item.attributes.name || 'Unknown Title',
                                                artist: item.attributes.artistName || 'Unknown Artist',
                                                album: item.attributes.albumName || 'Unknown Album',
                                                duration: formatDuration(item.attributes.durationInMillis || 0)
                                            });
                                        }
                                    });
                                }
                            });
                        } else if (jsonData.tracks) {
                            jsonData.tracks.forEach((track, idx) => {
                                jsonSongs.push({
                                    id: idx + 1,
                                    title: track.name || 'Unknown Title',
                                    artist: track.artistName || 'Unknown Artist',
                                    album: track.albumName || 'Unknown Album',
                                    duration: formatDuration(track.durationInMillis || 0)
                                });
                            });
                        }
                        
                        if (jsonSongs.length > 0) {
                            console.log(`Successfully extracted ${jsonSongs.length} songs from JSON data`);
                            
                            // 更新进度 - 完成
                            if (requestId) {
                                updateProgress(requestId, {
                                    status: 'completed',
                                    progress: 100,
                                    message: `成功从"${title}"中提取了 ${jsonSongs.length} 首歌曲`,
                                    current: 10,
                                    total: 10
                                });
                            }
                            
                            return {
                                playlistInfo: {
                                    title: title,
                                    creator: creator,
                                    songCount: jsonSongs.length
                                },
                                songs: jsonSongs
                            };
                        }
                    }
                } catch (e) {
                    // 忽略解析错误，继续尝试下一个script标签
                }
            }
        } catch (error) {
            console.error('Non-authenticated extraction failed:', error.message);
        }
        
        // 如果所有方法都失败，返回模拟数据
        console.log('All extraction methods failed for Apple Music, returning mock data');
        
        // 更新进度 - 提取失败
        if (requestId) {
            updateProgress(requestId, {
                status: 'failed',
                progress: 100,
                message: '无法提取歌单信息，返回示例数据。',
                current: 10,
                total: 10
            });
        }
        
        return getMockAppleData(playlistId);
    } catch (error) {
        console.error('Error extracting Apple Music playlist:', error);
        
        // 更新进度 - 发生错误
        if (requestId) {
            updateProgress(requestId, {
                status: 'error',
                progress: 100,
                message: `错误: ${error.message}. 返回示例数据。`,
                current: 10,
                total: 10
            });
        }
        
        return getMockAppleData();
    }
}

// Function to get mock Apple Music data
function getMockAppleData(playlistId = 'unknown') {
    // 特殊处理已知的歌单ID
    if (playlistId === 'pl.u-EgUaK573JL') {
        console.log('检测到特定歌单ID: pl.u-EgUaK573JL，但将尝试正常提取内容');
        // 不再返回特制数据，使用通用模拟数据
    }
    
    // 默认模拟数据
    return {
        playlistInfo: {
            title: `Apple Music 歌单 (ID: ${playlistId})`,
            creator: 'Apple Music 用户',
            songCount: 5,
            note: '这是示例数据。实际歌单提取失败。请尝试其他公开的Apple Music歌单链接。',
            extractionStatus: 'mock_data'
        },
        songs: [
            { id: 1, title: '示例歌曲 1', artist: 'Apple Music 艺术家', album: '示例专辑 1', duration: '3:45' },
            { id: 2, title: '示例歌曲 2', artist: 'Apple Music 艺术家', album: '示例专辑 2', duration: '4:12' },
            { id: 3, title: '示例歌曲 3', artist: 'Apple Music 艺术家', album: '示例专辑 3', duration: '3:21' },
            { id: 4, title: '示例歌曲 4', artist: 'Apple Music 艺术家', album: '示例专辑 4', duration: '2:55' },
            { id: 5, title: '示例歌曲 5', artist: 'Apple Music 艺术家', album: '示例专辑 5', duration: '5:07' }
        ]
    };
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
async function extractNeteaseMusicPlaylist(url, requestId = null) {
    try {
        console.log('Attempting to extract Netease Music playlist from URL:', url);
        
        // 更新进度 - 开始提取
        if (requestId) {
            updateProgress(requestId, {
                status: 'extracting',
                progress: 5,
                message: 'Extracting Netease Music playlist ID...',
                current: 1,
                total: 10
            });
        }
        
        // Extract the playlist ID from the URL
        const playlistId = extractNeteaseMusicPlaylistId(url);
        if (!playlistId) {
            console.log('Invalid Netease Music playlist URL - could not extract ID');
            throw new Error('Invalid Netease Music playlist URL');
        }
        
        console.log('Extracted Netease playlist ID:', playlistId);
        
        // 更新进度 - 已获取歌单ID
        if (requestId) {
            updateProgress(requestId, {
                progress: 10,
                message: `Successfully extracted playlist ID: ${playlistId}. Fetching playlist details...`,
                current: 2,
                total: 10
            });
        }
        
        // 存储所有歌曲ID的数组
        let allTrackIds = [];
        let playlistName = '';
        let creatorName = '';
        
        // 首先尝试使用API v6获取歌单基本信息和trackIds
        try {
            // 使用API v6获取歌单基本信息
            const apiUrl = `https://music.163.com/api/v6/playlist/detail?id=${playlistId}`;
            console.log('Attempting API request to:', apiUrl);
            
            // 更新进度 - 正在获取API数据
            if (requestId) {
                updateProgress(requestId, {
                    progress: 20,
                    message: 'Requesting playlist data from Netease API...',
                    current: 3,
                    total: 10
                });
            }
            
            const apiResponse = await axios.get(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': `https://music.163.com/playlist?id=${playlistId}`,
                    'Accept': 'application/json, text/plain, */*'
                }
            });
            
            console.log('API response status:', apiResponse.status);
            console.log('API response data keys:', Object.keys(apiResponse.data));
            
            // 检查响应是否包含预期的结构
            const responseData = apiResponse.data;
            
            // 更新进度 - 正在解析API数据
            if (requestId) {
                updateProgress(requestId, {
                    progress: 30,
                    message: 'API responded successfully. Parsing playlist information...',
                    current: 4,
                    total: 10
                });
            }
            
            // 从响应中获取trackIds
            if (responseData && responseData.playlist) {
                playlistName = responseData.playlist.name || 'Netease Music Playlist';
                creatorName = responseData.playlist.creator ? responseData.playlist.creator.nickname : 'Unknown Creator';
                
                console.log(`Playlist name: ${playlistName}`);
                console.log(`Creator: ${creatorName}`);
                
                // 更新进度 - 获取了歌单信息
                if (requestId) {
                    updateProgress(requestId, {
                        progress: 40,
                        message: `Found playlist: "${playlistName}" by ${creatorName}. Collecting track IDs...`,
                        current: 5,
                        total: 10
                    });
                }
                
                // 检查是否有trackIds字段，这通常包含所有歌曲的ID
                if (responseData.playlist.trackIds && Array.isArray(responseData.playlist.trackIds)) {
                    console.log(`Found ${responseData.playlist.trackIds.length} track IDs in API v6 response`);
                    
                    // 存储所有的trackIds
                    allTrackIds = responseData.playlist.trackIds.map(track => ({
                        id: track.id.toString(),
                        title: 'Unknown Title' // 我们稍后会获取标题
                    }));
                    
                    console.log(`Total track IDs collected: ${allTrackIds.length}`);
                    
                    // 更新进度 - 收集了所有歌曲ID
                    if (requestId) {
                        updateProgress(requestId, {
                            progress: 50,
                            message: `Collected ${allTrackIds.length} track IDs. Processing song details...`,
                            current: 6,
                            total: 10
                        });
                    }
                }
                
                // 如果API v6返回了tracks，我们可以用它初始化歌曲信息
                if (responseData.playlist.tracks && responseData.playlist.tracks.length > 0) {
                    console.log(`API v6 response contains ${responseData.playlist.tracks.length} tracks with details`);
                    
                    // 如果trackIds数量与tracks数量相同，我们可以直接使用tracks
                    if (allTrackIds.length === responseData.playlist.tracks.length) {
                        console.log('Track count matches trackIds count, using API v6 tracks data');
                        
                        // 更新进度 - 处理API返回的完整歌曲信息
                        if (requestId) {
                            updateProgress(requestId, {
                                progress: 90,
                                message: `Processing ${responseData.playlist.tracks.length} complete songs from API response...`,
                                current: 9,
                                total: 10
                            });
                        }
                        
                        const apiSongs = responseData.playlist.tracks.map((track, index) => {
                            return {
                                id: index + 1,
                                title: track.name || 'Unknown Title',
                                artist: track.ar ? track.ar.map(artist => artist.name).join(', ') : 'Unknown Artist',
                                album: track.al ? track.al.name : 'Unknown Album',
                                duration: formatDuration(track.dt || 0),
                                songId: track.id
                            };
                        });
                        
                        console.log(`Successfully extracted ${apiSongs.length} complete songs from API v6`);
                        
                        // 更新进度 - 完成提取
                        if (requestId) {
                            updateProgress(requestId, {
                                status: 'completed',
                                progress: 100,
                                message: `Successfully extracted ${apiSongs.length} songs from "${playlistName}"`,
                                current: 10,
                                total: 10
                            });
                        }
                        
                        return {
                            playlistInfo: {
                                title: playlistName,
                                creator: creatorName,
                                songCount: apiSongs.length
                            },
                            songs: apiSongs
                        };
                    }
                    
                    // 如果tracks只是部分数据，我们稍后将获取剩余的数据
                    console.log('API v6 returned partial tracks data, will fetch remaining tracks');
                }
            }
        } catch (apiV6Error) {
            console.error('API v6 extraction failed:', apiV6Error.message);
            
            // 更新进度 - API v6失败
            if (requestId) {
                updateProgress(requestId, {
                    progress: 35,
                    message: 'API v6 request failed. Trying alternative methods...',
                    current: 4,
                    total: 10
                });
            }
        }
        
        // 如果API v6不能获取所有trackIds，尝试使用旧版API
        if (allTrackIds.length === 0) {
            try {
                console.log('Trying original API to get track IDs');
                const alternativeApiUrl = `https://music.163.com/api/playlist/detail?id=${playlistId}`;
                
                const altApiResponse = await axios.get(alternativeApiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Referer': `https://music.163.com/playlist?id=${playlistId}`,
                        'Accept': 'application/json, text/plain, */*'
                    }
                });
                
                const altResponseData = altApiResponse.data;
                
                if (altResponseData && altResponseData.result) {
                    // 如果没有设置歌单信息，从这个API设置
                    if (!playlistName) {
                        playlistName = altResponseData.result.name || 'Netease Music Playlist';
                    }
                    
                    if (!creatorName) {
                        creatorName = altResponseData.result.creator ? altResponseData.result.creator.nickname : 'Unknown Creator';
                    }
                    
                    // 检查trackIds
                    if (altResponseData.result.trackIds && Array.isArray(altResponseData.result.trackIds)) {
                        console.log(`Found ${altResponseData.result.trackIds.length} track IDs in original API response`);
                        
                        // 存储所有的trackIds
                        allTrackIds = altResponseData.result.trackIds.map(track => ({
                            id: track.id.toString(),
                            title: 'Unknown Title'
                        }));
                        
                        console.log(`Total track IDs collected: ${allTrackIds.length}`);
                    }
                    
                    // 如果API返回了完整的tracks数据，我们可以直接使用
                    if (allTrackIds.length > 0 && 
                        altResponseData.result.tracks && 
                        altResponseData.result.tracks.length === allTrackIds.length) {
                        
                        console.log('Original API returned complete tracks data');
                        
                        const apiSongs = altResponseData.result.tracks.map((track, index) => {
                            return {
                                id: index + 1,
                                title: track.name || 'Unknown Title',
                                artist: track.artists ? track.artists.map(artist => artist.name).join(', ') : 'Unknown Artist',
                                album: track.album ? track.album.name : 'Unknown Album',
                                duration: formatDuration(track.duration || 0),
                                songId: track.id
                            };
                        });
                        
                        console.log(`Successfully extracted ${apiSongs.length} complete songs from original API`);
                        
                        return {
                            playlistInfo: {
                                title: playlistName,
                                creator: creatorName,
                                songCount: apiSongs.length
                            },
                            songs: apiSongs
                        };
                    }
                }
            } catch (altApiError) {
                console.error('Original API extraction failed:', altApiError.message);
            }
        }
        
        // 如果我们仍然没有trackIds，尝试从网页抓取
        if (allTrackIds.length === 0) {
            try {
                // 使用网页抓取方法获取歌单信息
                const webUrl = `https://music.163.com/playlist?id=${playlistId}`;
                console.log('Attempting to scrape playlist page to get track IDs:', webUrl);
                
                const response = await axios.get(webUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7'
                    }
                });
                
                const $ = cheerio.load(response.data);
                
                // 提取歌单标题和创建者
                if (!playlistName) {
                    playlistName = $('h2.f-ff2').text().trim() || 
                              $('.tit.f-ff2').text().trim() ||
                              $('meta[property="og:title"]').attr('content') || 
                              'Netease Music Playlist';
                }
                
                if (!creatorName) {
                    creatorName = $('.user.f-cb .name').text().trim() || 
                           $('.user .name').text().trim() || 
                           'Unknown Creator';
                }
                
                console.log('Extracted playlist info from web:', { playlistName, creatorName });
                
                // 尝试获取歌曲总数
                let totalSongs = 0;
                const countText = $('.sub.s-fc3').text() || $('.m-info .sub').text();
                if (countText) {
                    const countMatch = countText.match(/共(\d+)首/);
                    if (countMatch && countMatch[1]) {
                        totalSongs = parseInt(countMatch[1], 10);
                        console.log(`Playlist contains ${totalSongs} songs according to page info`);
                    }
                }
                
                // 检查iframe
                const iframeSrc = $('#g_iframe').attr('src');
                if (iframeSrc) {
                    console.log('Found iframe, attempting to extract from:', iframeSrc);
                    
                    const fullIframeSrc = iframeSrc.startsWith('http') ? iframeSrc : `https://music.163.com${iframeSrc}`;
                    
                    const iframeResponse = await axios.get(fullIframeSrc, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            'Referer': webUrl
                        }
                    });
                    
                    const iframe$ = cheerio.load(iframeResponse.data);
                    
                    // 从iframe内容中提取歌曲ID
                    iframe$('ul.f-hide li a').each((index, element) => {
                        const href = iframe$(element).attr('href');
                        if (href) {
                            const match = href.match(/id=(\d+)/);
                            if (match && match[1]) {
                                allTrackIds.push({
                                    id: match[1],
                                    title: iframe$(element).text().trim()
                                });
                            }
                        }
                    });
                    
                    console.log(`Found ${allTrackIds.length} track IDs in iframe`);
                    
                    // 尝试从脚本标签提取更多歌曲ID
                    const scriptTags = iframe$('script');
                    scriptTags.each((index, element) => {
                        const scriptContent = iframe$(element).html();
                        if (scriptContent && (
                            scriptContent.includes('window.PLAYLIST_TRACK_FULL_INFO') || 
                            scriptContent.includes('GCollection') ||
                            scriptContent.includes('GPlaylist')
                        )) {
                            try {
                                // 尝试各种可能的格式提取JSON数据
                                let jsonMatch = scriptContent.match(/window\.PLAYLIST_TRACK_FULL_INFO\s*=\s*(\[.*?\]);/s);
                                if (!jsonMatch) {
                                    jsonMatch = scriptContent.match(/GCollection\s*=\s*({.*?});/s);
                                }
                                if (!jsonMatch) {
                                    jsonMatch = scriptContent.match(/GPlaylist\s*=\s*({.*?});/s);
                                }
                                
                                if (jsonMatch && jsonMatch[1]) {
                                    let jsonData;
                                    try {
                                        jsonData = JSON.parse(jsonMatch[1]);
                                    } catch (e) {
                                        // 如果是对象而不是数组，尝试从中获取歌曲列表
                                        if (typeof jsonMatch[1] === 'string' && jsonMatch[1].startsWith('{')) {
                                            const objData = JSON.parse(jsonMatch[1]);
                                            if (objData.tracks) {
                                                jsonData = objData.tracks;
                                            } else if (objData.songlist) {
                                                jsonData = objData.songlist;
                                            }
                                        }
                                    }
                                    
                                    if (jsonData && Array.isArray(jsonData)) {
                                        console.log(`Found ${jsonData.length} songs in script tag`);
                                        
                                        // 添加未在列表中的歌曲ID
                                        jsonData.forEach(song => {
                                            if (song.id && !allTrackIds.some(s => s.id === song.id.toString())) {
                                                allTrackIds.push({
                                                    id: song.id.toString(),
                                                    title: song.name || 'Unknown Title'
                                                });
                                            }
                                        });
                                        
                                        console.log(`Total track IDs after script extraction: ${allTrackIds.length}`);
                                    }
                                }
                            } catch (e) {
                                console.error('Error parsing script JSON:', e.message);
                            }
                        }
                    });
                }
                
                // 如果没有找到trackIds，尝试从主页面获取
                if (allTrackIds.length === 0) {
                    console.log('No track IDs found in iframe, trying main page');
                    
                    $('ul.f-hide li a').each((index, element) => {
                        const href = $(element).attr('href');
                        if (href) {
                            const match = href.match(/id=(\d+)/);
                            if (match && match[1]) {
                                allTrackIds.push({
                                    id: match[1],
                                    title: $(element).text().trim()
                                });
                            }
                        }
                    });
                    
                    console.log(`Found ${allTrackIds.length} track IDs in main page`);
                    
                    // 尝试从页面的脚本标签中提取更多信息
                    if (allTrackIds.length < totalSongs && totalSongs > 0) {
                        $('script').each((index, element) => {
                            const scriptContent = $(element).html();
                            if (scriptContent && scriptContent.includes('window.__INITIAL_DATA__')) {
                                try {
                                    const jsonMatch = scriptContent.match(/window\.__INITIAL_DATA__\s*=\s*({.*?});/s);
                                    if (jsonMatch && jsonMatch[1]) {
                                        const jsonData = JSON.parse(jsonMatch[1]);
                                        
                                        // 从不同可能的结构中查找歌曲列表
                                        let trackList = null;
                                        if (jsonData.playlist && jsonData.playlist.tracks) {
                                            trackList = jsonData.playlist.tracks;
                                        } else if (jsonData.playlist && jsonData.playlist.trackIds) {
                                            trackList = jsonData.playlist.trackIds;
                                        }
                                        
                                        if (trackList && Array.isArray(trackList)) {
                                            console.log(`Found ${trackList.length} track IDs in __INITIAL_DATA__`);
                                            
                                            trackList.forEach(track => {
                                                const trackId = track.id ? track.id.toString() : (track.track ? track.track.id.toString() : null);
                                                if (trackId && !allTrackIds.some(s => s.id === trackId)) {
                                                    allTrackIds.push({
                                                        id: trackId,
                                                        title: track.name || (track.track ? track.track.name : 'Unknown Title')
                                                    });
                                                }
                                            });
                                            
                                            console.log(`Total track IDs after __INITIAL_DATA__ extraction: ${allTrackIds.length}`);
                                        }
                                    }
                                } catch (e) {
                                    console.error('Error parsing __INITIAL_DATA__ JSON:', e.message);
                                }
                            }
                        });
                    }
                }
            } catch (webError) {
                console.error('Error in web scraping approach:', webError.message);
            }
        }
        
        // 如果我们有trackIds，为每首歌曲获取详细信息
        if (allTrackIds.length > 0) {
            console.log(`Fetching details for ${allTrackIds.length} songs`);
            
            // 更新进度 - 开始获取歌曲详情
            if (requestId) {
                updateProgress(requestId, {
                    progress: 60,
                    message: `Fetching details for ${allTrackIds.length} songs...`,
                    current: 7,
                    total: 10
                });
            }
            
            const songs = [];
            
            // 使用批处理方法避免超载服务器
            const batchSize = 20; // 每批次的歌曲数
            const batches = Math.ceil(allTrackIds.length / batchSize);
            
            // 对于大型歌单，我们使用批量歌曲详情API
            if (allTrackIds.length > 50) {
                console.log('Using batch song details API for large playlist');
                
                for (let i = 0; i < batches; i++) {
                    const start = i * batchSize;
                    const end = Math.min(start + batchSize, allTrackIds.length);
                    const batch = allTrackIds.slice(start, end);
                    
                    console.log(`Processing batch ${i+1}/${batches} (songs ${start+1}-${end})`);
                    
                    // 更新进度 - 处理批次
                    if (requestId) {
                        const currentProgress = 60 + Math.floor(30 * (i / batches));
                        updateProgress(requestId, {
                            progress: currentProgress,
                            message: `Processing batch ${i+1}/${batches} (songs ${start+1}-${end})...`,
                            current: 7,
                            total: 10,
                            batch: {
                                current: i + 1,
                                total: batches,
                                processed: start,
                                totalSongs: allTrackIds.length
                            }
                        });
                    }
                    
                    try {
                        // 创建一个由所有ID组成的列表
                        const songIds = batch.map(song => song.id);
                        
                        // 使用批量API获取多首歌曲的详情
                        const batchUrl = `https://music.163.com/api/song/detail?ids=[${songIds.join(',')}]`;
                        
                        const batchResponse = await axios.get(batchUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                                'Referer': `https://music.163.com/playlist?id=${playlistId}`
                            }
                        });
                        
                        if (batchResponse.data && batchResponse.data.songs && Array.isArray(batchResponse.data.songs)) {
                            const batchSongs = batchResponse.data.songs;
                            console.log(`Received details for ${batchSongs.length} songs in batch`);
                            
                            // 处理每首歌曲的详情
                            batchSongs.forEach((song, batchIndex) => {
                                const index = start + batchIndex;
                                
                                songs.push({
                                    id: index + 1,
                                    title: song.name || batch[batchIndex].title,
                                    artist: song.artists ? song.artists.map(artist => artist.name).join(', ') : 'Unknown Artist',
                                    album: song.album ? song.album.name : 'Unknown Album',
                                    duration: formatDuration(song.duration || 0),
                                    songId: song.id
                                });
                            });
                            
                            // 如果批处理API未返回所有歌曲，记录下来
                            if (batchSongs.length < batch.length) {
                                const missingSongs = batch.length - batchSongs.length;
                                console.log(`Warning: Batch API returned ${batchSongs.length} songs, expected ${batch.length} (missing ${missingSongs})`);
                                
                                // 对于缺失的歌曲，我们添加尽可能多的信息
                                const returnedIds = batchSongs.map(song => song.id.toString());
                                const missingBatch = batch.filter(song => !returnedIds.includes(song.id));
                                
                                missingBatch.forEach((missingSong, missIndex) => {
                                    songs.push({
                                        id: start + batchSongs.length + missIndex + 1,
                                        title: missingSong.title || 'Unknown Title',
                                        artist: 'Unknown Artist',
                                        album: 'Unknown Album',
                                        duration: '0:00',
                                        songId: missingSong.id
                                    });
                                });
                            }
                        } else {
                            console.log(`Batch API returned no song details for batch ${i+1}`);
                            
                            // 如果批处理API失败，我们添加基本信息
                            batch.forEach((song, batchIndex) => {
                                const index = start + batchIndex;
                                
                                songs.push({
                                    id: index + 1,
                                    title: song.title || 'Unknown Title',
                                    artist: 'Unknown Artist',
                                    album: 'Unknown Album',
                                    duration: '0:00',
                                    songId: song.id
                                });
                            });
                        }
                    } catch (batchError) {
                        console.error(`Error fetching batch ${i+1} song details:`, batchError.message);
                        
                        // 批处理API失败时，对每首歌添加基本信息
                        batch.forEach((song, batchIndex) => {
                            const index = start + batchIndex;
                            
                            songs.push({
                                id: index + 1,
                                title: song.title || 'Unknown Title',
                                artist: 'Unknown Artist',
                                album: 'Unknown Album',
                                duration: '0:00',
                                songId: song.id
                            });
                        });
                    }
                    
                    // 在批次之间添加延迟，避免触发API的速率限制
                    if (i < batches - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            } else {
                // 对于小型歌单，我们使用单一歌曲详情API，这可能更可靠
                console.log('Using individual song details API for small playlist');
                
                for (let i = 0; i < batches; i++) {
                    const start = i * batchSize;
                    const end = Math.min(start + batchSize, allTrackIds.length);
                    const batch = allTrackIds.slice(start, end);
                    
                    console.log(`Processing batch ${i+1}/${batches} (songs ${start+1}-${end})`);
                    
                    // 为批次中的每首歌创建Promise
                    const batchPromises = batch.map((song, batchIndex) => {
                        const index = start + batchIndex;
                        
                        return fetchSongDetails(song.id)
                            .then(details => {
                                songs.push({
                                    id: index + 1,
                                    title: song.title !== 'Unknown Title' ? song.title : details.title || 'Unknown Title',
                                    artist: details.artist || 'Unknown Artist',
                                    album: details.album || 'Unknown Album',
                                    duration: details.duration || '0:00',
                                    songId: song.id
                                });
                            })
                            .catch(err => {
                                console.error(`Error fetching details for song ${song.id}:`, err.message);
                                songs.push({
                                    id: index + 1,
                                    title: song.title || 'Unknown Title',
                                    artist: 'Unknown Artist',
                                    album: 'Unknown Album',
                                    duration: '0:00',
                                    songId: song.id
                                });
                            });
                    });
                    
                    // 等待批次中的所有Promise完成
                    await Promise.all(batchPromises);
                    
                    // 在批次之间添加延迟
                    if (i < batches - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            }
            
            // 按ID排序歌曲，保持顺序
            songs.sort((a, b) => a.id - b.id);
            
            console.log(`Successfully extracted ${songs.length} songs with details`);
            
            // 更新进度 - 完成提取
            if (requestId) {
                updateProgress(requestId, {
                    status: 'completed',
                    progress: 100,
                    message: `Successfully extracted ${songs.length} songs from "${playlistName}"`,
                    current: 10,
                    total: 10
                });
            }
            
            return {
                playlistInfo: {
                    title: playlistName,
                    creator: creatorName,
                    songCount: songs.length
                },
                songs: songs
            };
        }
        
        // 如果所有方法都失败，返回模拟数据
        console.log('All extraction approaches failed, returning mock data');
        
        // 更新进度 - 提取失败，返回模拟数据
        if (requestId) {
            updateProgress(requestId, {
                status: 'failed',
                progress: 100,
                message: 'Extraction failed. Returning mock data.',
                current: 10,
                total: 10
            });
        }
        
        return getMockNeaseData(playlistId);
        
    } catch (error) {
        console.error('Error extracting Netease Music playlist:', error);
        
        // 更新进度 - 发生错误
        if (requestId) {
            updateProgress(requestId, {
                status: 'error',
                progress: 100,
                message: `Error: ${error.message}. Returning mock data.`,
                current: 10,
                total: 10
            });
        }
        
        // 作为最后的手段返回模拟数据
        return getMockNeaseData();
    }
}

// Helper function to fetch song details from Netease Music
async function fetchSongDetails(songId) {
    try {
        console.log(`Fetching details for song ID: ${songId}`);
        
        // Use the song API to get details
        const songApiUrl = `https://music.163.com/api/song/detail/?id=${songId}&ids=[${songId}]`;
        
        const response = await axios.get(songApiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': `https://music.163.com/song?id=${songId}`,
                'Accept': 'application/json, text/plain, */*'
            }
        });
        
        if (response.data && response.data.songs && response.data.songs.length > 0) {
            const songData = response.data.songs[0];
            
            return {
                title: songData.name || 'Unknown Title',
                artist: songData.artists ? songData.artists.map(artist => artist.name).join(', ') : 'Unknown Artist',
                album: songData.album ? songData.album.name : 'Unknown Album',
                duration: formatDuration(songData.duration || 0)
            };
        }
        
        throw new Error('Song details not found in API response');
    } catch (error) {
        console.error(`Error fetching song details for ${songId}:`, error.message);
        return {
            title: 'Unknown Title',
            artist: 'Unknown Artist',
            album: 'Unknown Album',
            duration: '0:00'
        };
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
async function extractQQMusicPlaylist(url, requestId = null) {
    try {
        console.log('Attempting to extract QQ Music playlist from URL:', url);
        
        // 更新进度 - 开始提取
        if (requestId) {
            updateProgress(requestId, {
                status: 'extracting',
                progress: 5,
                message: 'Extracting QQ Music playlist ID...',
                current: 1,
                total: 10
            });
        }
        
        // Extract the playlist ID from the URL
        const playlistId = extractQQMusicPlaylistId(url);
        if (!playlistId) {
            console.log('Invalid QQ Music playlist URL - could not extract ID');
            throw new Error('Invalid QQ Music playlist URL');
        }
        
        console.log('Extracted QQ Music playlist ID:', playlistId);
        
        // Try multiple approaches to extract QQ Music playlist data
        
        // Approach 1: Use the API endpoint
        try {
            // QQ Music uses multiple APIs for different parts of playlist data
            const playlistInfoUrl = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${playlistId}&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`;
            console.log('Attempting API request to:', playlistInfoUrl);
            
            // Make request with proper headers to avoid CSRF protection
            const response = await axios.get(playlistInfoUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': 'https://y.qq.com/n/yqq/playlist/' + playlistId + '.html',
                    'Accept': 'application/json, text/plain, */*'
                }
            });
            
            console.log('QQ Music API response status:', response.status);
            console.log('API response sample:', JSON.stringify(response.data).substring(0, 200) + '...');
            
            const data = response.data;
            if (!data.cdlist || !data.cdlist[0]) {
                console.log('No playlist data returned from QQ Music API');
                throw new Error('No playlist data returned from QQ Music API');
            }
            
            const playlistData = data.cdlist[0];
            
            const playlistInfo = {
                title: playlistData.dissname || 'Unknown Playlist',
                creator: playlistData.nickname || 'Unknown Creator',
                songCount: playlistData.songnum || (playlistData.songlist ? playlistData.songlist.length : 0)
            };
            
            console.log('Extracted playlist info:', playlistInfo);
            
            // Check if we have song data
            if (!playlistData.songlist || playlistData.songlist.length === 0) {
                console.log('No songs found in API response');
                throw new Error('No songs found in API response');
            }
            
            const songs = playlistData.songlist.map((song, index) => {
                return {
                    id: index + 1,
                    title: song.songname || 'Unknown Title',
                    artist: song.singer ? song.singer.map(s => s.name).join(', ') : 'Unknown Artist',
                    album: song.albumname || 'Unknown Album',
                    duration: formatDuration(song.interval * 1000) // Convert seconds to milliseconds
                };
            });
            
            console.log(`Successfully extracted ${songs.length} songs via QQ Music API`);
            return { playlistInfo, songs };
            
        } catch (apiError) {
            console.error('QQ Music API extraction failed:', apiError.message);
            
            // Try a different API endpoint
            try {
                console.log('Trying alternative API endpoint');
                
                // Alternative API endpoint
                const altApiUrl = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg?id=${playlistId}&format=json&platform=yqq`;
                console.log('Attempting request to alternative API:', altApiUrl);
                
                const altResponse = await axios.get(altApiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Referer': 'https://y.qq.com/',
                        'Accept': 'application/json, text/plain, */*'
                    }
                });
                
                console.log('Alternative API response status:', altResponse.status);
                console.log('Alternative API response sample:', JSON.stringify(altResponse.data).substring(0, 200) + '...');
                
                const altData = altResponse.data;
                if (altData.data && altData.data.cdlist && altData.data.cdlist[0]) {
                    const altPlaylistData = altData.data.cdlist[0];
                    
                    const altPlaylistInfo = {
                        title: altPlaylistData.dissname || 'Unknown Playlist',
                        creator: altPlaylistData.nickname || 'Unknown Creator',
                        songCount: altPlaylistData.songnum || (altPlaylistData.songlist ? altPlaylistData.songlist.length : 0)
                    };
                    
                    console.log('Extracted playlist info from alternative API:', altPlaylistInfo);
                    
                    if (altPlaylistData.songlist && altPlaylistData.songlist.length > 0) {
                        const altSongs = altPlaylistData.songlist.map((song, index) => {
                            return {
                                id: index + 1,
                                title: song.songname || 'Unknown Title',
                                artist: song.singer ? song.singer.map(s => s.name).join(', ') : 'Unknown Artist',
                                album: song.albumname || 'Unknown Album',
                                duration: formatDuration(song.interval * 1000)
                            };
                        });
                        
                        console.log(`Successfully extracted ${altSongs.length} songs via alternative API`);
                        return { playlistInfo: altPlaylistInfo, songs: altSongs };
                    }
                }
                
                console.log('Alternative API did not return usable data');
                throw new Error('Alternative API did not return usable data');
                
            } catch (altApiError) {
                console.error('Alternative API extraction failed:', altApiError.message);
                
                // Approach 2: Try web scraping
                try {
                    console.log('Attempting web scraping for QQ Music');
                    
                    // Construct the web URL - try multiple formats
                    const webUrls = [
                        `https://y.qq.com/n/ryqq/playlist/${playlistId}`,
                        `https://y.qq.com/n/yqq/playlist/${playlistId}.html`
                    ];
                    
                    let webData = null;
                    let webStatus = 0;
                    
                    // Try each URL format
                    for (const webUrl of webUrls) {
                        try {
                            console.log('Attempting to scrape from URL:', webUrl);
                            
                            const webResponse = await axios.get(webUrl, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                                    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7'
                                }
                            });
                            
                            console.log(`Web response status for ${webUrl}:`, webResponse.status);
                            
                            if (webResponse.status === 200 && webResponse.data) {
                                webData = webResponse.data;
                                webStatus = webResponse.status;
                                console.log('Successfully retrieved web page content');
                                console.log('Web content sample:', webData.substring(0, 200) + '...');
                                break;
                            }
                        } catch (urlError) {
                            console.error(`Error fetching ${webUrl}:`, urlError.message);
                        }
                    }
                    
                    if (!webData) {
                        throw new Error('Failed to retrieve web page content from any URL');
                    }
                    
                    // Check if the page contains song list indicators
                    const hasSongList = webData.includes('songlist__list') || 
                                      webData.includes('song_list') || 
                                      webData.includes('playlist__list');
                    console.log('Web page contains song list indicators:', hasSongList);
                    
                    const $ = cheerio.load(webData);
                    
                    // Extract playlist information
                    const title = $('.data__name_txt').text().trim() || 
                                 $('.playlist-title').text().trim() ||
                                 $('meta[property="og:title"]').attr('content') ||
                                 'Unknown Playlist';
                                 
                    const creator = $('.data__author a').text().trim() || 
                                   $('.playlist-author').text().trim() ||
                                   'Unknown Creator';
                    
                    console.log('Extracted playlist info via scraping:', { title, creator });
                    
                    // Extract songs - try multiple selectors
                    const songs = [];
                    
                    // Try multiple selectors for song lists
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
                    
                    console.log(`Method 1 found ${songs.length} songs`);
                    
                    // Try alternative selector
                    if (songs.length === 0) {
                        $('.song_list .song_item').each((index, element) => {
                            const songTitle = $(element).find('.song_name').text().trim();
                            const artist = $(element).find('.song_artist').text().trim();
                            const album = $(element).find('.song_album').text().trim();
                            const duration = $(element).find('.song_time').text().trim();
                            
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
                        console.log(`Method 2 found ${songs.length} songs`);
                    }
                    
                    // Try another alternative selector
                    if (songs.length === 0) {
                        $('table.playlist__list tr').each((index, element) => {
                            // Skip header row
                            if (index === 0) return;
                            
                            const songTitle = $(element).find('.playlist__song_name').text().trim();
                            const artist = $(element).find('.playlist__author').text().trim();
                            const album = $(element).find('.playlist__album').text().trim();
                            const duration = $(element).find('.playlist__time').text().trim();
                            
                            if (songTitle) {
                                songs.push({
                                    id: index,
                                    title: songTitle,
                                    artist: artist,
                                    album: album,
                                    duration: duration
                                });
                            }
                        });
                        console.log(`Method 3 found ${songs.length} songs`);
                    }
                    
                    // Try a more generic selector
                    if (songs.length === 0) {
                        $('.song_title, .song-name, .songname').each((index, element) => {
                            const songTitle = $(element).text().trim();
                            const parent = $(element).closest('div, li, tr');
                            const artist = parent.find('.singer, .artist, .singer-name').text().trim() || 'Unknown Artist';
                            
                            if (songTitle && songTitle !== 'Name' && songTitle !== 'Title') {
                                songs.push({
                                    id: index + 1,
                                    title: songTitle,
                                    artist: artist,
                                    album: 'Unknown Album',
                                    duration: '0:00'
                                });
                            }
                        });
                        console.log(`Method 4 found ${songs.length} songs`);
                    }
                    
                    // If we found songs, return them
                    if (songs.length > 0) {
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
                    
                    // Check if there's a script tag with JSON data
                    console.log('Looking for JSON data in script tags');
                    let jsonData = null;
                    
                    // Look for script tags with JSON data
                    const scriptContent = webData.match(/window\.__INITIAL_DATA__\s*=\s*({.*?});/s);
                    
                    if (scriptContent && scriptContent[1]) {
                        try {
                            console.log('Found potential JSON data in script tag');
                            jsonData = JSON.parse(scriptContent[1]);
                            console.log('JSON data keys:', Object.keys(jsonData));
                        } catch (e) {
                            console.error('Error parsing JSON data:', e.message);
                        }
                    }
                    
                    if (jsonData) {
                        // Try to find song list in different JSON structures
                        let songList = null;
                        
                        if (jsonData.detail && jsonData.detail.songList) {
                            songList = jsonData.detail.songList;
                        } else if (jsonData.playlist && jsonData.playlist.songList) {
                            songList = jsonData.playlist.songList;
                        } else if (jsonData.cdlist && jsonData.cdlist[0] && jsonData.cdlist[0].songlist) {
                            songList = jsonData.cdlist[0].songlist;
                        }
                        
                        if (songList && Array.isArray(songList) && songList.length > 0) {
                            console.log(`Found ${songList.length} songs in JSON data`);
                            
                            const jsonSongs = songList.map((song, index) => {
                                return {
                                    id: index + 1,
                                    title: song.title || song.name || song.songname || 'Unknown Title',
                                    artist: song.singer ? song.singer.map(s => s.name).join(', ') : 
                                           song.artist || song.singerName || 'Unknown Artist',
                                    album: song.album ? song.album.name : song.albumname || 'Unknown Album',
                                    duration: formatDuration((song.interval || song.duration || 0) * 1000)
                                };
                            });
                            
                            console.log(`Successfully extracted ${jsonSongs.length} songs from JSON data`);
                            
                            // Get playlist title and creator from JSON if available
                            let jsonTitle = title;
                            let jsonCreator = creator;
                            
                            if (jsonData.detail) {
                                jsonTitle = jsonData.detail.title || jsonTitle;
                                jsonCreator = jsonData.detail.creator ? jsonData.detail.creator.name : jsonCreator;
                            } else if (jsonData.playlist) {
                                jsonTitle = jsonData.playlist.title || jsonTitle;
                                jsonCreator = jsonData.playlist.creator || jsonCreator;
                            } else if (jsonData.cdlist && jsonData.cdlist[0]) {
                                jsonTitle = jsonData.cdlist[0].dissname || jsonTitle;
                                jsonCreator = jsonData.cdlist[0].nickname || jsonCreator;
                            }
                            
                            return {
                                playlistInfo: {
                                    title: jsonTitle,
                                    creator: jsonCreator,
                                    songCount: jsonSongs.length
                                },
                                songs: jsonSongs
                            };
                        }
                    }
                    
                    // If we still couldn't extract songs, throw an error
                    throw new Error('Failed to extract songs from QQ Music web page');
                    
                } catch (scrapingError) {
                    console.error('QQ Music web scraping failed:', scrapingError.message);
                    
                    // If all approaches failed, return mock data
                    console.log('All extraction approaches failed for QQ Music, returning mock data');
                    return getMockQQData(playlistId);
                }
            }
        }
    } catch (error) {
        console.error('Error extracting QQ Music playlist:', error);
        return getMockQQData();
    }
}

// Function to get mock QQ Music data
function getMockQQData(playlistId = 'unknown') {
    return {
        playlistInfo: {
            title: `QQ Music Playlist ${playlistId}`,
            creator: 'QQ Music User',
            songCount: 5,
            note: 'This is mock data. The actual playlist extraction failed.',
            extractionStatus: 'mock_data'
        },
        songs: [
            { id: 1, title: 'QQ Song 1', artist: 'QQ Artist 1', album: 'QQ Album 1', duration: '3:45' },
            { id: 2, title: 'QQ Song 2', artist: 'QQ Artist 2', album: 'QQ Album 2', duration: '4:12' },
            { id: 3, title: 'QQ Song 3', artist: 'QQ Artist 3', album: 'QQ Album 3', duration: '3:21' },
            { id: 4, title: 'QQ Song 4', artist: 'QQ Artist 4', album: 'QQ Album 4', duration: '2:55' },
            { id: 5, title: 'QQ Song 5', artist: 'QQ Artist 5', album: 'QQ Album 5', duration: '5:07' }
        ]
    };
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

// 格式化毫秒为时间字符串
function formatDuration(ms) {
    if (!ms || isNaN(ms)) return '0:00';
    
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Start server
const startServer = (port) => {
    const server = app.listen(port, () => {
        console.log(`Server running on port ${port}`);
        console.log(`Access the application at http://localhost:${port}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} is busy, trying port ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });
};

startServer(PORT); 

module.exports = {
    extractNeteaseMusicPlaylist,
    extractQQMusicPlaylist,
    extractAppleMusicPlaylist,
    extractionProgress,
    updateProgress
};