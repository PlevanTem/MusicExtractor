import { extractionProgress } from '../server';

export default function handler(req, res) {
  const requestId = req.query.requestId;
  
  // 设置 SSE 头部
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
  const progress = extractionProgress.get(requestId) || {
    status: 'unknown',
    progress: 0,
    message: 'No progress data available'
  };
  
  res.write(`data: ${JSON.stringify(progress)}\n\n`);
  
  // 设置定时器定期发送进度更新
  const intervalId = setInterval(() => {
    const currentProgress = extractionProgress.get(requestId);
    if (currentProgress) {
      res.write(`data: ${JSON.stringify(currentProgress)}\n\n`);
      
      // 如果进度已完成或出错，关闭连接
      if (['completed', 'error', 'failed'].includes(currentProgress.status)) {
        clearInterval(intervalId);
        res.end();
      }
    }
  }, 1000);
  
  // 客户端断开连接时清理
  res.on('close', () => {
    clearInterval(intervalId);
    console.log('SSE connection closed for request ID:', requestId);
  });
}