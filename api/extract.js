const { extractNeteaseMusicPlaylist, extractQQMusicPlaylist, extractAppleMusicPlaylist } = require('../server');

export default async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // 处理 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const { url, platform, requestId, userToken } = req.body;
      
      console.log('Received extraction request for', platform, 'playlist:', url);
      
      let result;
      
      // 根据平台调用相应的提取函数
      if (platform === 'netease') {
        result = await extractNeteaseMusicPlaylist(url, requestId);
      } else if (platform === 'qq') {
        result = await extractQQMusicPlaylist(url, requestId);
      } else if (platform === 'apple') {
        result = await extractAppleMusicPlaylist(url, requestId, userToken);
      } else {
        throw new Error('Unsupported platform');
      }
      
      res.status(200).json(result);
    } catch (error) {
      console.error('Extraction error:', error);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}