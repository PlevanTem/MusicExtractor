# Playlist Information Extractor

A minimalist web application that extracts song information from playlist sharing URLs from various music platforms.

## Features

- **Multi-Platform Support**: Extract playlist data from Apple Music, Netease Music, and QQ Music
- **Clean Display**: View extracted playlist information in a clean, minimalist interface
- **Export Options**: Download playlist data in CSV or TXT format
- **User-Friendly**: Simple interface with straightforward workflow

## Technologies Used

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js with Express
- **Data Extraction**: Axios for API requests and Cheerio for web scraping

## Setup Instructions

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```
4. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Paste a playlist URL from a supported music platform (Apple Music, Netease Music, or QQ Music)
2. Select the correct platform
3. Click "Extract Playlist"
4. View the extracted song information
5. Export the data in your preferred format (CSV or TXT)

## Known Limitations

### Netease Music API Restrictions

The Netease Music API has several limitations:

1. **Authentication Requirements**: Some playlists require user login to access
2. **Rate Limiting**: The API may limit requests from the same IP address
3. **Error Code 20001**: This error indicates that the playlist requires authentication or has access restrictions
4. **Regional Restrictions**: Some playlists may only be accessible from certain regions

For Netease Music playlists that cannot be extracted, the application will display mock data. For better results:

- Try playlists that are publicly accessible
- Use the URL format `https://music.163.com/#/playlist?id=PLAYLIST_ID`
- Consider setting up a proxy server using [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) for more reliable extraction

### Apple Music and QQ Music

These platforms may also have limitations similar to Netease Music. The application attempts to extract data using multiple methods, but success depends on the playlist's accessibility and format.

## Notes

- This application uses web scraping techniques which may break if the target websites change their structure
- Some platforms may limit or block automated access to their content
- Always comply with the Terms of Service of the music platforms

## License

MIT 