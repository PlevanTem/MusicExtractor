document.addEventListener('DOMContentLoaded', () => {
    const playlistForm = document.getElementById('playlist-form');
    const resultsContainer = document.getElementById('results-container');
    const songsListContainer = document.getElementById('songs-list');
    const playlistTitleElement = document.getElementById('playlist-title');
    const playlistDetailsElement = document.getElementById('playlist-details');
    const loadingIndicator = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const exportCsvButton = document.getElementById('export-csv');
    const exportTxtButton = document.getElementById('export-txt');
    const songsContainer = document.querySelector('.songs-container');
    const playlistInfoElement = document.querySelector('.playlist-info');
    
    let extractedSongs = [];
    let playlistInfo = {
        title: '',
        creator: '',
        songCount: 0
    };
    
    let progressEventSource = null;
    
    // Apple Music授权相关变量
    let appleMusicUserToken = null;
    let appleMusicInstance = null;
    let appleMusicInitialized = false;
    let pendingExtraction = null;
    
    // 生成唯一的请求ID
    function generateRequestId() {
        return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    // 懒加载MusicKit JS
    function loadMusicKitJS() {
        return new Promise((resolve, reject) => {
            if (typeof MusicKit !== 'undefined') {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load MusicKit JS'));
            document.head.appendChild(script);
        });
    }
    
    // 初始化Apple Music
    async function initializeAppleMusic() {
        if (appleMusicInitialized) return true;
        
        try {
            // 使用Web播放器方式初始化MusicKit
            // 这种方式不需要开发者令牌，但功能会受限
            MusicKit.configure({
                app: {
                    name: 'Playlist Extractor',
                    build: '1.0.0'
                }
            });
            
            appleMusicInstance = MusicKit.getInstance();
            appleMusicInitialized = true;
            
            // 设置授权状态变更监听器
            appleMusicInstance.addEventListener('authorizationStatusDidChange', () => {
                if (appleMusicInstance.isAuthorized) {
                    // 获取用户Token
                    appleMusicUserToken = appleMusicInstance.musicUserToken;
                    console.log('Apple Music authorized successfully');
                    
                    // 更新授权状态指示器
                    updateAuthIndicator(true);
                    
                    // 如果有待处理的提取请求，继续执行
                    if (pendingExtraction) {
                        const { url, platform, requestId } = pendingExtraction;
                        pendingExtraction = null;
                        performExtraction(url, platform, requestId, true);
                    }
                } else {
                    appleMusicUserToken = null;
                    console.log('Apple Music not authorized');
                    
                    // 更新授权状态指示器
                    updateAuthIndicator(false);
                    
                    // 如果授权被拒绝，但有待处理的提取请求，使用非授权模式继续
                    if (pendingExtraction) {
                        const { url, platform, requestId } = pendingExtraction;
                        pendingExtraction = null;
                        performExtraction(url, platform, requestId, false);
                    }
                }
            });
            
            return true;
        } catch (error) {
            console.error('Apple Music initialization failed:', error);
            appleMusicInitialized = false;
            return false;
        }
    }
    
    // Handle form submission
    playlistForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const playlistUrl = document.getElementById('playlist-url').value.trim();
        const platform = document.querySelector('input[name="platform"]:checked').value;
        
        if (!playlistUrl) {
            showError('Please enter a valid playlist URL');
            return;
        }
        
        // 生成唯一的请求ID
        const requestId = generateRequestId();
        
        // 关闭之前的事件源
        if (progressEventSource) {
            progressEventSource.close();
        }
        
        // 显示结果容器，但隐藏歌曲列表和歌单信息，只显示加载指示器
        resultsContainer.style.display = 'block';
        songsContainer.style.display = 'none';
        playlistInfoElement.style.display = 'none';
        errorMessage.style.display = 'none';
        
        // 显示加载指示器
        showLoading('正在初始化提取过程...');
        
        // 连接到进度更新的SSE端点
        connectToProgressUpdates(requestId);
        
        // 如果是Apple Music，总是尝试授权
        if (platform === 'apple') {
            try {
                await loadMusicKitJS();
                const initialized = await initializeAppleMusic();
                
                if (initialized) {
                    // 无论是否已授权，都尝试进行授权（如果已授权，这不会有任何影响）
                    pendingExtraction = { url: playlistUrl, platform, requestId };
                    updateLoadingText('正在请求Apple Music授权...');
                    
                    try {
                        // 如果已经授权，这不会显示授权窗口，但会确保我们使用授权模式
                        if (!appleMusicInstance.isAuthorized) {
                            // 添加授权状态指示器
                            const authIndicator = document.createElement('div');
                            authIndicator.classList.add('auth-indicator', 'authenticating');
                            authIndicator.textContent = '正在授权...';
                            loadingIndicator.appendChild(authIndicator);
                            
                            await appleMusicInstance.authorize();
                            // 授权结果会通过authorizationStatusDidChange事件处理
                        } else {
                            // 已授权，直接提取
                            performExtraction(playlistUrl, platform, requestId, true);
                        }
                    } catch (authError) {
                        console.error('授权请求失败:', authError);
                        // 授权失败，使用非授权模式继续
                        pendingExtraction = null;
                        performExtraction(playlistUrl, platform, requestId, false);
                    }
                } else {
                    // 初始化失败，使用非授权模式
                    performExtraction(playlistUrl, platform, requestId, false);
                }
            } catch (error) {
                console.error('Apple Music setup error:', error);
                // 出错，使用非授权模式
                performExtraction(playlistUrl, platform, requestId, false);
            }
        } else {
            // 非Apple Music平台，正常提取
            performExtraction(playlistUrl, platform, requestId, false);
        }
    });
    
    // 执行提取操作
    async function performExtraction(url, platform, requestId, useAuth = false) {
        try {
            // 对于Apple Music，如果已初始化但未指定useAuth，尝试检查授权状态
            if (platform === 'apple' && appleMusicInitialized && !useAuth) {
                useAuth = appleMusicInstance.isAuthorized;
            }
            
            updateLoadingText(useAuth ? '使用授权模式提取歌单...' : '提取歌单信息...');
            
            // 构建请求数据
            const requestData = { url, platform, requestId };
            
            // 如果使用授权模式且有用户令牌，添加到请求中
            if (useAuth && appleMusicUserToken) {
                requestData.userToken = appleMusicUserToken;
                console.log('使用授权模式提取Apple Music歌单');
                
                // 更新授权状态指示器
                updateAuthIndicator(true);
            } else if (platform === 'apple') {
                console.log('使用非授权模式提取Apple Music歌单');
                
                // 更新授权状态指示器
                updateAuthIndicator(false);
            }
            
            // 发送提取请求
            const data = await extractPlaylistData(requestData);
            
            // 关闭进度更新流
            if (progressEventSource) {
                progressEventSource.close();
                progressEventSource = null;
            }
            
            // 隐藏加载指示器
            hideLoading();
            
            // 显示歌曲列表和歌单信息
            songsContainer.style.display = 'block';
            playlistInfoElement.style.display = 'block';
            
            // 处理和显示数据
            processPlaylistData(data);
        } catch (error) {
            console.error('Error extracting playlist data:', error);
            
            // 关闭进度更新流
            if (progressEventSource) {
                progressEventSource.close();
                progressEventSource = null;
            }
            
            // 隐藏加载指示器
            hideLoading();
            
            // 显示错误信息
            showError('Failed to extract playlist data. Please check the URL and try again.');
        }
    }
    
    // 更新加载文本
    function updateLoadingText(message) {
        const loadingText = loadingIndicator.querySelector('p');
        if (loadingText) {
            loadingText.textContent = message;
        }
    }
    
    // 连接到SSE流，接收进度更新
    function connectToProgressUpdates(requestId) {
        progressEventSource = new EventSource(`/api/progress?requestId=${requestId}`);
        
        progressEventSource.onmessage = function(event) {
            try {
                const progress = JSON.parse(event.data);
                console.log('Progress update:', progress);
                
                // 更新加载指示器显示进度
                updateLoadingIndicator(progress);
                
                // 如果进度已完成或发生错误，关闭连接
                if (['completed', 'error', 'failed'].includes(progress.status)) {
                    progressEventSource.close();
                    progressEventSource = null;
                }
            } catch (e) {
                console.error('Error parsing progress update:', e);
            }
        };
        
        progressEventSource.onerror = function(error) {
            console.error('SSE error:', error);
            progressEventSource.close();
            progressEventSource = null;
        };
    }
    
    // 更新加载指示器显示进度
    function updateLoadingIndicator(progress) {
        const loadingText = loadingIndicator.querySelector('p');
        
        // 设置进度消息
        if (loadingText) {
            loadingText.textContent = progress.message || 'Extracting playlist information...';
        }
        
        // 如果我们有详细的批处理进度，显示更多进度信息
        if (progress.batch) {
            const { current, total, processed, totalSongs } = progress.batch;
            const progressPercent = Math.round(progress.progress);
            
            const detailParagraph = document.querySelector('.loading-progress-detail') || 
                                   document.createElement('p');
            
            if (!detailParagraph.classList.contains('loading-progress-detail')) {
                detailParagraph.classList.add('loading-progress-detail');
                loadingIndicator.appendChild(detailParagraph);
            }
            
            detailParagraph.textContent = `批次 ${current}/${total} • 已处理 ${processed} / ${totalSongs} 首歌曲 • ${progressPercent}% 完成`;
            
            // 添加进度条
            let progressBar = document.querySelector('.loading-progress-bar');
            let progressBarContainer = document.querySelector('.loading-progress-bar-container');
            
            if (!progressBarContainer) {
                progressBarContainer = document.createElement('div');
                progressBarContainer.classList.add('loading-progress-bar-container');
                
                progressBar = document.createElement('div');
                progressBar.classList.add('loading-progress-bar');
                
                progressBarContainer.appendChild(progressBar);
                loadingIndicator.appendChild(progressBarContainer);
            }
            
            if (progressBar) {
                progressBar.style.width = `${progressPercent}%`;
            }
        } else if (progress.progress) {
            // 即使没有批处理信息，只要有进度百分比也显示进度条
            const progressPercent = Math.round(progress.progress);
            
            let progressBar = document.querySelector('.loading-progress-bar');
            let progressBarContainer = document.querySelector('.loading-progress-bar-container');
            
            if (!progressBarContainer) {
                progressBarContainer = document.createElement('div');
                progressBarContainer.classList.add('loading-progress-bar-container');
                
                progressBar = document.createElement('div');
                progressBar.classList.add('loading-progress-bar');
                
                progressBarContainer.appendChild(progressBar);
                loadingIndicator.appendChild(progressBarContainer);
            }
            
            if (progressBar) {
                progressBar.style.width = `${progressPercent}%`;
            }
            
            // 添加简单的进度文本
            const detailParagraph = document.querySelector('.loading-progress-detail') || 
                                   document.createElement('p');
            
            if (!detailParagraph.classList.contains('loading-progress-detail')) {
                detailParagraph.classList.add('loading-progress-detail');
                loadingIndicator.appendChild(detailParagraph);
            }
            
            detailParagraph.textContent = `${progressPercent}% 完成`;
        }
    }
    
    // Export buttons event listeners
    exportCsvButton.addEventListener('click', () => {
        exportData('csv');
    });
    
    exportTxtButton.addEventListener('click', () => {
        exportData('txt');
    });
    
    // Function to extract playlist data (real implementation)
    async function extractPlaylistData(requestData) {
        try {
            console.log('Sending request to extract playlist:', requestData);
            
            const response = await fetch('/api/extract', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            // Log the response status
            console.log('API response status:', response.status);
            
            // Try to parse response as text first for debugging
            const responseText = await response.text();
            console.log('API response text:', responseText);
            
            // If response is empty, throw an error
            if (!responseText) {
                throw new Error('Empty response received from the server');
            }
            
            // Parse the text to JSON
            const data = JSON.parse(responseText);
            
            // Check if the response contains an error
            if (data.error) {
                throw new Error(data.error);
            }
            
            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }
    
    // Process and display playlist data
    function processPlaylistData(data) {
        // Store the data for export functionality
        extractedSongs = data.songs;
        playlistInfo = data.playlistInfo;
        
        // Update playlist info
        playlistTitleElement.textContent = playlistInfo.title;
        
        // 检查数据类型
        if (playlistInfo.extractionStatus === 'mock_data') {
            // 显示模拟数据警告
            playlistDetailsElement.innerHTML = `
                <span style="color: #ff6b6b;">${playlistInfo.songCount} 首歌曲 • 由 ${playlistInfo.creator} 创建</span>
                <div class="mock-data-warning">
                    <p style="color: #ff6b6b; margin-top: 10px; font-size: 0.9em;">
                        ⚠️ ${playlistInfo.note || '提取失败，显示模拟数据。请尝试其他歌单链接。'}
                    </p>
                </div>
            `;
        } else if (playlistInfo.extractionStatus === 'preview_data') {
            // 显示预览数据提示
            playlistDetailsElement.innerHTML = `
                <span style="color: #4a90e2;">${playlistInfo.songCount} 首歌曲 • 由 ${playlistInfo.creator} 创建</span>
                <div class="preview-data-info">
                    <p style="color: #4a90e2; margin-top: 10px; font-size: 0.9em;">
                        ℹ️ ${playlistInfo.note || '这是预览数据，基于歌单的部分信息生成。'}
                    </p>
                </div>
            `;
        } else if (playlistInfo.extractionStatus === 'authenticated_data') {
            // 显示授权数据提示
            playlistDetailsElement.innerHTML = `
                <span style="color: #4caf50;">${playlistInfo.songCount} 首歌曲 • 由 ${playlistInfo.creator} 创建</span>
                <div class="authenticated-data-info">
                    <p style="color: #4caf50; margin-top: 10px; font-size: 0.9em;">
                        ✓ 使用Apple Music授权获取的完整数据
                    </p>
                </div>
            `;
        } else {
            // 正常显示
            playlistDetailsElement.textContent = `${playlistInfo.songCount} songs • Created by ${playlistInfo.creator}`;
        }
        
        // Clear previous results
        songsListContainer.innerHTML = '';
        
        // Add songs to the table
        data.songs.forEach((song, index) => {
            const row = document.createElement('tr');
            
            // 根据数据类型设置样式
            if (playlistInfo.extractionStatus === 'mock_data') {
                row.style.color = '#999'; // 灰色
            } else if (playlistInfo.extractionStatus === 'preview_data') {
                row.style.color = '#4a90e2'; // 蓝色
            } else if (playlistInfo.extractionStatus === 'authenticated_data') {
                row.style.color = '#4caf50'; // 绿色
            }
            
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${escapeHtml(song.title)}</td>
                <td>${escapeHtml(song.artist)}</td>
                <td>${escapeHtml(song.album)}</td>
                <td>${escapeHtml(song.duration)}</td>
            `;
            songsListContainer.appendChild(row);
        });
    }
    
    // Function to escape HTML to prevent XSS
    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
    
    // Export data function
    function exportData(format) {
        if (extractedSongs.length === 0) {
            showError('No data to export');
            return;
        }
        
        let content = '';
        let filename = `${playlistInfo.title.replace(/\s+/g, '_')}_playlist`;
        
        if (format === 'csv') {
            // Create CSV content
            content = 'Title,Artist,Album,Duration\n';
            extractedSongs.forEach(song => {
                content += `"${escapeCsv(song.title)}","${escapeCsv(song.artist)}","${escapeCsv(song.album)}","${escapeCsv(song.duration)}"\n`;
            });
            filename += '.csv';
        } else if (format === 'txt') {
            // Create TXT content
            content = `${playlistInfo.title}\nCreated by: ${playlistInfo.creator}\n${playlistInfo.songCount} songs\n\n`;
            extractedSongs.forEach((song, index) => {
                content += `${index + 1}. ${song.title} - ${song.artist} (${song.album}) [${song.duration}]\n`;
            });
            filename += '.txt';
        }
        
        // Create download link
        const blob = new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
    
    // Helper function to escape CSV values
    function escapeCsv(text) {
        if (typeof text !== 'string') {
            return '';
        }
        return text.replace(/"/g, '""');
    }
    
    // Helper functions
    function showLoading(message = 'Extracting playlist information...') {
        loadingIndicator.style.display = 'block';
        
        // 设置初始加载消息
        const loadingText = loadingIndicator.querySelector('p');
        if (loadingText) {
            loadingText.textContent = message;
        }
        
        // 移除之前的进度详情和进度条
        const progressDetail = loadingIndicator.querySelector('.loading-progress-detail');
        if (progressDetail) {
            progressDetail.remove();
        }
        
        const progressBarContainer = loadingIndicator.querySelector('.loading-progress-bar-container');
        if (progressBarContainer) {
            progressBarContainer.remove();
        }
    }
    
    function hideLoading() {
        loadingIndicator.style.display = 'none';
    }
    
    function showResults() {
        resultsContainer.style.display = 'block';
    }
    
    function showError(message) {
        errorMessage.querySelector('p').textContent = message;
        errorMessage.style.display = 'block';
    }
    
    // 更新授权状态指示器
    function updateAuthIndicator(isAuthorized) {
        // 查找现有的指示器
        let authIndicator = document.querySelector('.auth-indicator');
        
        // 如果不存在，创建一个新的
        if (!authIndicator && loadingIndicator.style.display !== 'none') {
            authIndicator = document.createElement('div');
            authIndicator.classList.add('auth-indicator');
            loadingIndicator.appendChild(authIndicator);
        }
        
        // 如果存在，更新其状态
        if (authIndicator) {
            authIndicator.classList.remove('authenticating');
            
            if (isAuthorized) {
                authIndicator.classList.add('authenticated');
                authIndicator.textContent = '已授权';
            } else {
                authIndicator.classList.remove('authenticated');
                authIndicator.textContent = '未授权';
            }
        }
    }
}); 