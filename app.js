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
    
    let extractedSongs = [];
    let playlistInfo = {
        title: '',
        creator: '',
        songCount: 0
    };
    
    // Handle form submission
    playlistForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const playlistUrl = document.getElementById('playlist-url').value.trim();
        const platform = document.querySelector('input[name="platform"]:checked').value;
        
        if (!playlistUrl) {
            showError('Please enter a valid playlist URL');
            return;
        }
        
        // Show loading indicator
        showLoading();
        
        try {
            // Make actual API call to backend
            const data = await extractPlaylistData(playlistUrl, platform);
            
            // Process and display the data
            processPlaylistData(data);
            
            // Hide loading and show results
            hideLoading();
            showResults();
        } catch (error) {
            console.error('Error extracting playlist data:', error);
            hideLoading();
            showError('Failed to extract playlist data. Please check the URL and try again.');
        }
    });
    
    // Export buttons event listeners
    exportCsvButton.addEventListener('click', () => {
        exportData('csv');
    });
    
    exportTxtButton.addEventListener('click', () => {
        exportData('txt');
    });
    
    // Function to extract playlist data (real implementation)
    async function extractPlaylistData(url, platform) {
        try {
            const response = await fetch('/api/extract', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url, platform })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to extract playlist data');
            }
            
            return await response.json();
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
        playlistDetailsElement.textContent = `${playlistInfo.songCount} songs • Created by ${playlistInfo.creator}`;
        
        // Clear previous results
        songsListContainer.innerHTML = '';
        
        // Add songs to the table
        data.songs.forEach((song, index) => {
            const row = document.createElement('tr');
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
    function showLoading() {
        loadingIndicator.style.display = 'block';
        errorMessage.style.display = 'none';
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
        resultsContainer.style.display = 'block';
    }
}); 