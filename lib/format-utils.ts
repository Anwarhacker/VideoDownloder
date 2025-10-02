export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDuration(seconds: number): string {
  if (!seconds) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function getQualityLabel(quality: string): string {
  const labels: { [key: string]: string } = {
    '2160p': '4K (2160p)',
    '1440p': '2K (1440p)',
    '1080p': 'Full HD (1080p)',
    '720p': 'HD (720p)',
    '480p': 'SD (480p)',
    'audio': 'Audio Only (MP3)',
  };
  return labels[quality] || quality;
}

export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    const urlPattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitter\.com|x\.com|tiktok\.com|instagram\.com|facebook\.com|reddit\.com|twitch\.tv)/i;
    return urlPattern.test(url);
  } catch {
    return false;
  }
}
