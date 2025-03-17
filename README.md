# 歌单信息提取器

一个简约风格的网页应用，可从各大音乐平台的歌单分享链接中提取歌曲信息。
> 注意：vercel网页链接仅呈现静态预览，并不具有后端提取交互能力，请根据安装说明下载到本地使用

## 功能特点

- **多平台支持**：支持从网易云音乐、QQ音乐和Apple Music提取歌单数据
- **简洁界面**：在简约、清晰的界面中查看提取的歌单信息
- **导出选项**：将歌单数据下载为CSV或TXT格式
- **用户友好**：简单的界面和直观的操作流程

## 使用技术

- **前端**：HTML, CSS, JavaScript
- **后端**：基于Express的Node.js
- **数据提取**：使用Axios进行API请求，Cheerio进行网页解析

## 安装说明

1. 克隆此仓库
2. 安装依赖：
   ```
   npm install
   ```
3. 启动服务器：
   ```
   npm start
   ```
4. 打开浏览器，访问 `http://localhost:3000`

## 使用方法

1. 粘贴支持的音乐平台（网易云音乐、QQ音乐或Apple Music）的歌单URL
2. 选择正确的平台
3. 点击"提取歌单"
4. 查看提取的歌曲信息
5. 以您喜欢的格式（CSV或TXT）导出数据

## 已知限制

### Apple Music和QQ音乐

1. **认证要求**：歌单需要用户登录才能访问完整，仅支持提取部分，仍在解决中...

## 注意事项

- 本应用使用网页抓取技术，如果目标网站更改其结构，可能会导致功能失效
- 某些平台可能会限制或阻止自动访问其内容
- 请始终遵守音乐平台的服务条款

## 许可证

MIT
