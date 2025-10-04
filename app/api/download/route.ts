import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { createReadStream, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import connectToDatabase from '@/lib/mongodb';
import DownloadSession from '@/lib/models/DownloadSession';

// Using MongoDB Atlas for all data storage

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

// Increase timeout for large video downloads (5 minutes)
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase(); // Will throw error if Atlas connection fails

    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    const action = searchParams.get('action');

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    const session = await DownloadSession.findOne({ sessionId: id });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (action === 'progress') {
      return NextResponse.json({
        status: session.status,
        progress: session.progress,
        error: session.error,
      });
    }

    if (action === 'file') {
      if (session.status !== 'completed' || !session.tempFile) {
        return NextResponse.json({ error: 'Download not ready' }, { status: 400 });
      }

      try {
        // Check if file exists and get its size
        const stats = await new Promise((resolve, reject) => {
          const fs = require('fs');
          fs.stat(session.tempFile!, (err: any, stats: any) => {
            if (err) reject(err);
            else resolve(stats);
          });
        });

        const fileSize = (stats as any).size;
        console.log(`Streaming file: ${session.filename} (${Math.round(fileSize / (1024 * 1024))}MB)`);

        // Create read stream with optimized chunk size for large files
        const fileStream = createReadStream(session.tempFile, {
          highWaterMark: 64 * 1024, // 64KB chunks to prevent memory issues
        });

        let bytesSent = 0;

        // Clean up after streaming is complete
        fileStream.on('end', async () => {
          try {
            console.log(`File streaming completed: ${session.filename}`);
            unlinkSync(session.tempFile!);
            await DownloadSession.deleteOne({ sessionId: id });
          } catch (err) {
            console.error('Failed to clean up:', err);
          }
        });

        fileStream.on('data', (chunk) => {
          bytesSent += chunk.length;
        });

        fileStream.on('error', (error) => {
          console.error('File streaming error:', error);
        });

        return new NextResponse(Readable.toWeb(fileStream) as any, {
          headers: {
            'Content-Type': session.contentType,
            'Content-Disposition': `attachment; filename="${session.filename}"`,
            'Content-Length': fileSize.toString(),
            'Cache-Control': 'no-cache',
            'Accept-Ranges': 'bytes',
          },
        });
      } catch (error) {
        console.error('File access error:', error);
        return NextResponse.json({ error: 'File not found or inaccessible' }, { status: 404 });
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase(); // Will throw error if Atlas connection fails

    const { url, quality } = await request.json();

    if (!url || !quality) {
      return NextResponse.json(
        { error: 'URL and quality are required' },
        { status: 400 }
      );
    }

    // Get video info to check file size
    const ytdlpCmdInfo = getYtdlpCommand();
    console.log('Getting video info with command:', ytdlpCmdInfo);

    const videoInfo = await new Promise((resolve, reject) => {
      const child = spawn(ytdlpCmdInfo, ['--dump-json', '--no-playlist', url], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        console.log('Video info process closed with code:', code);
        if (code === 0 && stdout) {
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            console.error('Failed to parse video info JSON:', e);
            reject(new Error('Failed to parse video info'));
          }
        } else {
          console.error('Video info failed - stderr:', stderr);
          reject(new Error(stderr || `Failed to get video info (exit code: ${code})`));
        }
      });

      child.on('error', (error) => {
        console.error('Video info spawn error:', error);
        reject(error);
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        console.log('Video info request timed out, killing process');
        child.kill();
        reject(new Error('Video info request timed out'));
      }, 30000);
    });

    // Calculate estimated file size for selected quality
    const duration = (videoInfo as any).duration || 0;
    let estimatedSize = 0;

    switch (quality) {
      case '2160p':
        estimatedSize = (videoInfo as any).filesize || Math.round(duration * 2000000 / 8);
        break;
      case '1440p':
        estimatedSize = (videoInfo as any).filesize || Math.round(duration * 1200000 / 8);
        break;
      case '1080p':
        estimatedSize = (videoInfo as any).filesize || Math.round(duration * 800000 / 8);
        break;
      case '720p':
        estimatedSize = (videoInfo as any).filesize || Math.round(duration * 500000 / 8);
        break;
      case '480p':
        estimatedSize = (videoInfo as any).filesize || Math.round(duration * 300000 / 8);
        break;
      case 'audio':
        estimatedSize = Math.round(duration * 128000 / 8);
        break;
    }

    // File size limits (in bytes)
    const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
    const WARN_FILE_SIZE = 500 * 1024 * 1024; // 500MB

    if (estimatedSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size too large (${Math.round(estimatedSize / (1024 * 1024))}MB). Maximum allowed size is ${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB.` },
        { status: 400 }
      );
    }

    if (estimatedSize > WARN_FILE_SIZE) {
      console.warn(`Large file download initiated: ${Math.round(estimatedSize / (1024 * 1024))}MB`);
    }

    let formatString = '';

    switch (quality) {
      case '2160p':
        formatString = 'best[height<=2160]';
        break;
      case '1440p':
        formatString = 'best[height<=1440]';
        break;
      case '1080p':
        formatString = 'best[height<=1080]';
        break;
      case '720p':
        formatString = 'best[height<=720]';
        break;
      case '480p':
        formatString = 'best[height<=480]';
        break;
      case 'audio':
        formatString = 'bestaudio';
        break;
      default:
        formatString = 'best';
    }

    const contentType = quality === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const fileExtension = quality === 'audio' ? 'mp3' : 'mp4';
    const filename = `download.${fileExtension}`;

    // Use a local downloads directory instead of system temp (better for containers)
    const downloadsDir = join(process.cwd(), 'downloads');
    const tempBaseName = `download-${randomUUID()}`;
    const tempFile = join(downloadsDir, `${tempBaseName}.${fileExtension}`);

    console.log('Downloads directory:', downloadsDir);
    console.log('Full temp file path:', tempFile);

    // Ensure downloads directory exists
    const fs = require('fs');
    if (!fs.existsSync(downloadsDir)) {
      console.log('Creating downloads directory');
      fs.mkdirSync(downloadsDir, { recursive: true });
    }

    const sessionId = randomUUID();

    // Create session in MongoDB Atlas
    const session = await DownloadSession.create({
      sessionId,
      url,
      quality,
      status: 'downloading',
      progress: 0,
      contentType,
      filename,
      tempFile,
    });

    const args = [
      '-f',
      formatString,
      '-o',
      tempFile, // Use full path for output
      '--no-playlist',
      url,
    ];

    if (quality === 'audio') {
      args.push('--extract-audio', '--audio-format', 'mp3');
    }

    const ytdlpCmd = getYtdlpCommand();
    console.log('Starting yt-dlp with command:', ytdlpCmd, args.join(' '));
    console.log('Output file will be:', tempFile);

    // Small delay to ensure session is saved
    await new Promise(resolve => setTimeout(resolve, 500));

    // Execute in current directory (don't change cwd in containers)
    console.log('Spawning yt-dlp process...');
    const ytdlp = spawn(ytdlpCmd, args);

    // Timeout to kill yt-dlp if it takes too long (30 minutes)
    const downloadTimeout = setTimeout(() => {
      console.log('Download timeout reached, killing yt-dlp process');
      ytdlp.kill();
    }, 30 * 60 * 1000);

    // Progress simulation timer for fallback
    let progressTimer: NodeJS.Timeout | null = null;
    let lastRealProgress = 0;
    let simulationStep = 0;

    const startProgressSimulation = () => {
      if (progressTimer) return; // Already running

      progressTimer = setInterval(async () => {
        try {
          // Only simulate if we haven't seen real progress recently
          const timeSinceLastProgress = Date.now() - lastRealProgress;
          if (timeSinceLastProgress > 5000) { // 5 seconds without real progress
            simulationStep++;
            let simulatedProgress = session.progress;

            if (simulationStep === 1 && simulatedProgress < 25) simulatedProgress = 25;
            else if (simulationStep === 2 && simulatedProgress < 50) simulatedProgress = 50;
            else if (simulationStep === 3 && simulatedProgress < 75) simulatedProgress = 75;
            else if (simulationStep >= 4 && simulatedProgress < 90) simulatedProgress = 90;

            if (simulatedProgress > session.progress) {
              await DownloadSession.updateOne(
                { sessionId },
                { progress: simulatedProgress }
              );
              console.log('Simulated progress:', simulatedProgress);
            }
          }
        } catch (error) {
          console.error('Error in progress simulation:', error);
        }
      }, 2000); // Update every 2 seconds
    };

    // Start simulation after a short delay
    setTimeout(startProgressSimulation, 2000);

    const parseProgress = async (output: string) => {
      try {
        let newProgress = session.progress;

        // Try multiple regex patterns for progress with more comprehensive matching
        let progressMatch = output.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (!progressMatch) {
          progressMatch = output.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of/);
        }
        if (!progressMatch) {
          progressMatch = output.match(/(\d+(?:\.\d+)?)%\s+of/);
        }
        if (!progressMatch) {
          progressMatch = output.match(/(\d+(?:\.\d+)?)%/);
        }
        if (!progressMatch) {
          progressMatch = output.match(/(\d+)%/);
        }

        if (progressMatch) {
          newProgress = Math.max(newProgress, parseFloat(progressMatch[1]));
          console.log('Progress match found:', newProgress);
        }

        // Check for specific yt-dlp progress indicators
        if (output.includes('[download]') && output.includes('Destination:')) {
          newProgress = Math.max(newProgress, 5);
        }
        if (output.includes('[download]') && output.includes('100%')) {
          newProgress = 100;
        }
        if (output.includes('has already been downloaded')) {
          newProgress = 100;
        }

        // Simulate progress if no real progress detected
        if (newProgress === session.progress && output.includes('[download]')) {
          // If we see download activity but no percentage, increment gradually
          if (session.progress < 10) newProgress = 10;
          else if (session.progress < 25) newProgress = 25;
          else if (session.progress < 50) newProgress = 50;
          else if (session.progress < 75) newProgress = 75;
          else if (session.progress < 100) newProgress = 90;
        }

        // Update progress if it changed
        if (newProgress !== session.progress) {
          newProgress = Math.min(newProgress, 100);

          await DownloadSession.updateOne(
            { sessionId },
            { progress: newProgress }
          );

          // Reset simulation timer since we got real progress
          lastRealProgress = Date.now();
          simulationStep = 0;

          console.log('Real progress updated to:', newProgress);
        }

        // Force completion on certain outputs
        if (output.includes('Merging formats') || output.includes('Deleting original file')) {
          await DownloadSession.updateOne(
            { sessionId },
            { progress: 100 }
          );
          console.log('Forced completion progress to 100%');
        }

        // Also force completion when download completes
        if (output.includes('[download] 100%') && output.includes('in ')) {
          await DownloadSession.updateOne(
            { sessionId },
            { progress: 100 }
          );
          console.log('Download 100% detected, setting progress to 100%');
        }

      } catch (error) {
        console.error('Error updating progress:', error);
      }
    };

    ytdlp.stdout.on('data', async (data) => {
      const output = data.toString();
      console.log('yt-dlp stdout:', output.trim()); // Debug logging
      await parseProgress(output);
    });

    ytdlp.stderr.on('data', async (data) => {
      const output = data.toString();
      console.log('yt-dlp stderr:', output.trim()); // Debug logging
      await parseProgress(output);
    });

    ytdlp.on('close', async (code) => {
      try {
        console.log('yt-dlp process closed with code:', code);

        // Clear timeout
        clearTimeout(downloadTimeout);

        // Clean up progress timer
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }

        // Check if file exists - yt-dlp might add extensions, so look for files starting with tempBaseName
        let actualTempFile = tempFile;
        const fs = require('fs');

        // First check if the expected file exists
        if (existsSync(tempFile)) {
          actualTempFile = tempFile;
        } else {
          // Look for files in downloads directory that start with our base name
          const files = fs.readdirSync(downloadsDir).filter((file: string) => file.startsWith(tempBaseName));
          if (files.length > 0) {
            // Use the first matching file (should be the output file)
            actualTempFile = join(downloadsDir, files[0]);
            console.log('Found output file:', actualTempFile);
          }
        }

        const fileExists = existsSync(actualTempFile);
        console.log('Output file exists:', fileExists);

        if (fileExists) {
          const stats = await new Promise((resolve, reject) => {
            fs.stat(actualTempFile, (err: any, stats: any) => {
              if (err) reject(err);
              else resolve(stats);
            });
          });
          console.log('Output file size:', (stats as any).size, 'bytes');
        }

        if ((code === 0 || code === null) && fileExists) {
          // Update session with actual file path
          await DownloadSession.updateOne(
            { sessionId },
            { status: 'completed', progress: 100, tempFile: actualTempFile }
          );
          console.log('Download completed successfully');
        } else {
          const errorMsg = `Download failed with code ${code}${fileExists ? '' : ' (no output file)'}`;
          await DownloadSession.updateOne(
            { sessionId },
            {
              status: 'error',
              error: errorMsg
            }
          );
          console.log('Download failed:', errorMsg);
          // Clean up temp file
          if (existsSync(actualTempFile)) {
            try {
              unlinkSync(actualTempFile);
            } catch (err) {
              console.error('Failed to clean up temp file on error:', err);
            }
          }
        }
      } catch (error) {
        console.error('Error updating session status:', error);
      }
    });

    ytdlp.on('error', async (error) => {
      try {
        console.log('yt-dlp spawn error:', error.message);
        console.log('Error details:', error);

        // Clear timeout
        clearTimeout(downloadTimeout);

        // Clean up progress timer
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }

        await DownloadSession.updateOne(
          { sessionId },
          {
            status: 'error',
            error: `Process error: ${error.message}`
          }
        );
        // Clean up any temp files with the base name
        const fs = require('fs');
        try {
          const files = fs.readdirSync(downloadsDir).filter((file: string) => file.startsWith(tempBaseName));
          for (const file of files) {
            try {
              unlinkSync(join(downloadsDir, file));
              console.log('Cleaned up temp file due to spawn error:', file);
            } catch (err) {
              console.error('Failed to clean up temp file on error:', err);
            }
          }
        } catch (err) {
          console.error('Failed to read downloads directory for cleanup:', err);
        }
      } catch (updateError) {
        console.error('Error updating session on spawn error:', updateError);
      }
    });

    return NextResponse.json({ id: sessionId });
  } catch (error: any) {
    console.error('Download error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate download' },
      { status: 500 }
    );
  }
}
