"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Video,
  Loader as Loader2,
  CircleAlert as AlertCircle,
  CircleCheck as CheckCircle2,
  Info,
} from "lucide-react";
import {
  formatFileSize,
  formatDuration,
  getQualityLabel,
  validateUrl,
} from "@/lib/format-utils";
import { toast } from "sonner";

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  description: string;
  availableQualities: string[];
  estimatedSizes: { [key: string]: number };
}

interface DownloadState {
  status: "idle" | "fetching" | "ready" | "downloading" | "completed" | "error";
  progress: number;
  error?: string;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedQuality, setSelectedQuality] = useState("1080p");
  const [downloadState, setDownloadState] = useState<DownloadState>({
    status: "idle",
    progress: 0,
  });

  const handleFetchInfo = async () => {
    if (!url.trim()) {
      toast.error("Please enter a video URL");
      return;
    }

    if (!validateUrl(url)) {
      toast.error("Invalid URL or unsupported platform");
      return;
    }

    setDownloadState({ status: "fetching", progress: 0 });
    setVideoInfo(null);

    try {
      const response = await fetch("/api/video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch video info");
      }

      setVideoInfo(data);
      if (data.availableQualities.length > 0) {
        setSelectedQuality(data.availableQualities[0]);
      }
      setDownloadState({ status: "ready", progress: 0 });
      toast.success("Video information loaded successfully");
    } catch (error: any) {
      setDownloadState({ status: "error", progress: 0, error: error.message });
      toast.error(error.message);
    }
  };

  const handleDownload = async () => {
    if (!videoInfo) return;

    setDownloadState({ status: "downloading", progress: 0 });

    try {
      // Start download
      const startResponse = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, quality: selectedQuality }),
      });

      if (!startResponse.ok) {
        const errorData = await startResponse.json();
        throw new Error(errorData.error || "Failed to start download");
      }

      const { id } = await startResponse.json();

      // Poll for progress
      const pollProgress = async () => {
        try {
          const progressResponse = await fetch(
            `/api/download?action=progress&id=${id}`
          );
          if (!progressResponse.ok) {
            throw new Error("Failed to get progress");
          }

          const progressData = await progressResponse.json();

          if (progressData.status === "completed") {
            // Download the file
            const fileResponse = await fetch(
              `/api/download?action=file&id=${id}`
            );
            if (!fileResponse.ok) {
              throw new Error("Failed to download file");
            }

            const blob = await fileResponse.blob();
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = `download.${
              selectedQuality === "audio" ? "mp3" : "mp4"
            }`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);

            setDownloadState({ status: "completed", progress: 100 });
            toast.success("Download completed successfully!");
          } else if (progressData.status === "error") {
            throw new Error(progressData.error || "Download failed");
          } else {
            setDownloadState({
              status: "downloading",
              progress: progressData.progress,
            });
            setTimeout(pollProgress, 1000); // Poll again in 1 second
          }
        } catch (error: any) {
          setDownloadState({
            status: "error",
            progress: 0,
            error: error.message,
          });
          toast.error(error.message);
        }
      };

      pollProgress();
    } catch (error: any) {
      setDownloadState({ status: "error", progress: 0, error: error.message });
      toast.error(error.message);
    }
  };

  const handleReset = () => {
    setUrl("");
    setVideoInfo(null);
    setDownloadState({ status: "idle", progress: 0 });
    setSelectedQuality("1080p");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-6 sm:py-8 max-w-5xl">
        <div className="text-center mb-8 sm:mb-12 pt-4 sm:pt-8">
          <div className="flex flex-col space-y-2 items-center justify-center mb-4">
            <Video className="w-8 h-8 sm:w-12 sm:h-12 text-blue-600 mr-3" />
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
              Video Downloader
            </h1>
          </div>
          <p className="text-slate-600 text-lg">
            Download videos from YouTube, Vimeo, and many more platforms
          </p>
        </div>

        <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Download className="w-6 h-6 text-blue-600" />
              Download Video
            </CardTitle>
            <CardDescription>
              Enter a video URL and select your preferred quality
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  type="url"
                  placeholder="Paste video URL here (YouTube, Vimeo, etc.)"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleFetchInfo()}
                  disabled={
                    downloadState.status === "fetching" ||
                    downloadState.status === "downloading"
                  }
                  className="text-base h-12 flex-1"
                />
                <Button
                  onClick={handleFetchInfo}
                  disabled={
                    downloadState.status === "fetching" ||
                    downloadState.status === "downloading"
                  }
                  size="lg"
                  className="px-6 bg-blue-600 hover:bg-blue-700 sm:w-auto w-full"
                >
                  {downloadState.status === "fetching" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading
                    </>
                  ) : (
                    <>
                      <Info className="w-4 h-4 mr-2" />
                      Get Info
                    </>
                  )}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs">
                  YouTube
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Vimeo
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Dailymotion
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Twitter
                </Badge>
                <Badge variant="outline" className="text-xs">
                  TikTok
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Instagram
                </Badge>
                <Badge variant="outline" className="text-xs">
                  +200 more
                </Badge>
              </div>
            </div>

            {downloadState.status === "error" && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{downloadState.error}</AlertDescription>
              </Alert>
            )}

            {videoInfo && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col sm:flex-row gap-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  {videoInfo.thumbnail && (
                    <img
                      src={videoInfo.thumbnail}
                      alt={videoInfo.title}
                      className="w-full sm:w-48 h-32 object-cover rounded-md shadow-md"
                    />
                  )}
                  <div className="flex-1 space-y-2">
                    <h3 className="font-semibold text-lg line-clamp-2">
                      {videoInfo.title}
                    </h3>
                    <p className="text-sm text-slate-600">
                      {videoInfo.uploader}
                    </p>
                    <div className="flex gap-4 text-sm text-slate-500">
                      <span>{formatDuration(videoInfo.duration)}</span>
                      {videoInfo.estimatedSizes[selectedQuality] && (
                        <span>
                          ≈{" "}
                          {formatFileSize(
                            videoInfo.estimatedSizes[selectedQuality]
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-slate-700">
                    Select Quality
                  </label>
                  <Select
                    value={selectedQuality}
                    onValueChange={setSelectedQuality}
                  >
                    <SelectTrigger className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {videoInfo.availableQualities.map((quality) => (
                        <SelectItem key={quality} value={quality}>
                          <div className="flex items-center justify-between w-full">
                            <span>{getQualityLabel(quality)}</span>
                            <span className="text-xs text-slate-500 ml-4">
                              {formatFileSize(
                                videoInfo.estimatedSizes[quality]
                              )}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {downloadState.status === "downloading" && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Downloading...</span>
                      <span className="font-semibold text-blue-600">
                        {downloadState.progress.toFixed(1)}%
                      </span>
                    </div>
                    <Progress value={downloadState.progress} className="h-2" />
                  </div>
                )}

                {downloadState.status === "completed" && (
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800">
                      Download completed! Check your downloads folder.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={handleDownload}
                    disabled={downloadState.status === "downloading"}
                    size="lg"
                    className="flex-1 h-12 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700"
                  >
                    {downloadState.status === "downloading" ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Downloading...
                      </>
                    ) : downloadState.status === "completed" ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 mr-2" />
                        Download Complete
                      </>
                    ) : (
                      <>
                        <Download className="w-5 h-5 mr-2" />
                        Download Video
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleReset}
                    variant="outline"
                    size="lg"
                    className="h-12 sm:w-auto w-full"
                  >
                    Reset
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-8 sm:mt-12 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg">High Quality</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600">
                Download videos up to 4K resolution with the best available
                quality
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg">Multiple Platforms</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600">
                Support for YouTube, Vimeo, Dailymotion, TikTok, and 200+
                platforms
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg">Fast & Secure</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600">
                Lightning-fast downloads with secure processing and no data
                storage
              </p>
            </CardContent>
          </Card>
        </div>

        <footer className="mt-12 text-center text-slate-500 text-sm border-t border-slate-200 pt-8">
          <p>
            Developed by Anwar Patel -{" "}
            <a
              href="mailto:patelanwar647@gmail.com"
              className="text-blue-600 hover:text-blue-700"
            >
              patelanwar647@gmail.com
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
