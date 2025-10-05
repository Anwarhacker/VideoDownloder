import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync } from 'fs';

const execPromise = promisify(exec);

// Get yt-dlp command - try system PATH first, then local exe for development
function getYtdlpCommand(): string {
  // For development, check for a local executable first
  if (process.env.NODE_ENV !== 'production') {
    const localPathExe = join(process.cwd(), 'yt-dlp.exe');
    if (existsSync(localPathExe)) {
      console.log('Using local yt-dlp.exe');
      return localPathExe;
    }
    const localPath = join(process.cwd(), 'yt-dlp');
    if (existsSync(localPath)) {
      console.log('Using local yt-dlp');
      return localPath;
    }
  }
  // For production or if local executable is not found, assume it's in the PATH
  console.log('Using yt-dlp from PATH');
  return 'yt-dlp';
}

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    const urlPattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitter\.com|x\.com|tiktok\.com|instagram\.com|facebook\.com|reddit\.com|twitch\.tv)/i;
    if (!urlPattern.test(url)) {
      return NextResponse.json(
        { error: 'Invalid or unsupported video URL' },
        { status: 400 }
      );
    }

    const ytdlpCmd = getYtdlpCommand();

    // Get browser from environment variables
    const browser = process.env.YT_DLP_BROWSER;

    let command = `${ytdlpCmd} --dump-json --no-playlist`;

    if (browser) {
      command += ` --cookies-from-browser ${browser}`;
      const userDataDir = process.env.YT_DLP_USER_DATA_DIR;
      if (userDataDir) {
        command += ` --user-data-dir "${userDataDir}"`;
      }
    }

    command += ` "${url}"`;

    const { stdout, stderr } = await execPromise(command, {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 10,
    });

    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    const videoInfo = JSON.parse(stdout);

    const formats = videoInfo.formats || [];
    const availableQualities = new Set<string>();

    formats.forEach((format: any) => {
      if (format.height) {
        if (format.height >= 2160) availableQualities.add('2160p');
        else if (format.height >= 1440) availableQualities.add('1440p');
        else if (format.height >= 1080) availableQualities.add('1080p');
        else if (format.height >= 720) availableQualities.add('720p');
        else if (format.height >= 480) availableQualities.add('480p');
      }
    });

    if (formats.some((f: any) => f.acodec && f.acodec !== 'none')) {
      availableQualities.add('audio');
    }

    const response = {
      title: videoInfo.title || 'Unknown Title',
      thumbnail: videoInfo.thumbnail || '',
      duration: videoInfo.duration || 0,
      uploader: videoInfo.uploader || 'Unknown',
      description: videoInfo.description?.substring(0, 200) || '',
      availableQualities: Array.from(availableQualities).sort((a, b) => {
        const order: { [key: string]: number } = { '2160p': 0, '1440p': 1, '1080p': 2, '720p': 3, '480p': 4, 'audio': 5 };
        return order[a] - order[b];
      }),
      estimatedSizes: {
        '2160p': videoInfo.filesize || Math.round((videoInfo.duration || 0) * 2000000 / 8),
        '1440p': videoInfo.filesize || Math.round((videoInfo.duration || 0) * 1200000 / 8),
        '1080p': videoInfo.filesize || Math.round((videoInfo.duration || 0) * 800000 / 8),
        '720p': videoInfo.filesize || Math.round((videoInfo.duration || 0) * 500000 / 8),
        '480p': videoInfo.filesize || Math.round((videoInfo.duration || 0) * 300000 / 8),
        'audio': Math.round((videoInfo.duration || 0) * 128000 / 8),
      },
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Video info extraction error:', error);

    if (error.message?.includes('not found') || error.code === 'ENOENT') {
      return NextResponse.json(
        { error: 'yt-dlp is not installed on the server. Please install it to use this feature.' },
        { status: 500 }
      );
    }

    if (error.message?.includes('Unsupported URL')) {
      return NextResponse.json(
        { error: 'This video platform is not supported' },
        { status: 400 }
      );
    }

    if (error.message?.includes('Video unavailable') || error.message?.includes('Private video')) {
      return NextResponse.json(
        { error: 'Video is unavailable or private' },
        { status: 404 }
      );
    }

    if (error.killed || error.signal === 'SIGTERM') {
      return NextResponse.json(
        { error: 'Request timed out. Please try again.' },
        { status: 408 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch video information. Please check the URL and try again.' },
      { status: 500 }
    );
  }
}
