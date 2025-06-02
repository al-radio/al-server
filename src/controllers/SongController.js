import SpotifyService from "../services/SpotifyService.js";
import QueueService from "../services/QueueService.js";
import OpenAIService from "../services/OpenAiService.js";
import TrackModelService from "../services/db/TrackModelService.js";
import ProxyService from "../services/ProxyService.js";

import { EndableError } from "../errors.js";

import fs from "fs";
import Throttle from "throttle";
import ffprobe from "ffprobe";
import ffprobeStatic from "ffprobe-static";
import { exec } from "child_process";
import { promisify } from "util";
import ClientManager from "../client/ClientManager.js";
import { log } from "../utils/logger.js";
import EventService from "../services/EventService.js";

class SongController {
  constructor() {
    this.songPlaying = false;
    this.currentSongMetadata = {};
    this.songDownloading = false;
    this.songDownloadingTrackId = null;
  }

  initialize() {
    log("info", "Initializing Song Controller", this.constructor.name);
    // Event listeners for the song player
    EventService.onWithServerContext("songQueued", () => this._player());
    EventService.onWithServerContext("clientConnected", () => this._player());
    EventService.onWithServerContext("songEnded", () => this._player());

    // Event listeners for the song gatherer
    EventService.onWithServerContext("notDownloading", () =>
      this._songGatherer(),
    );
    EventService.onWithServerContext("audioQueueNeedsFilling", () =>
      this._songGatherer(),
    );

    this._songGatherer();
  }

  // The song player. it takes the existing audio file and streams it to the clients.
  async _player() {
    log("info", "Song player triggered", this.constructor.name);
    if (
      this.songPlaying ||
      !ClientManager.hasActiveClients() ||
      QueueService.isAudioQueueEmpty()
    ) {
      log(
        "info",
        `Song player not ready. Song Playing? ${this.songPlaying} Active Clients? ${ClientManager.hasActiveClients()} Audio Queue Empty? ${QueueService.isAudioQueueEmpty()}`,
        this.constructor.name,
      );
      return;
    }
    const { path, metadata } = QueueService.popNextAudioFile() || {};
    if (path) {
      await this._markSongAsPlayed(metadata);
      this._streamToClients(path);
    }
  }

  // The song gatherer. it gets the next song from the queue and downloads it.
  async _songGatherer() {
    log("info", "Song Gatherer triggered", this.constructor.name);
    if (this.songDownloading || !QueueService.audioQueueNeedsFilling()) {
      log(
        "info",
        `Song Gatherer not ready. Song Downloading? ${this.songDownloading} Audio Queue Needs Filling? ${QueueService.audioQueueNeedsFilling()}`,
        this.constructor.name,
      );
      return;
    }

    let { trackId, userSubmittedId, requestId } =
      await QueueService.popNextTrack();
    if (!trackId) {
      log(
        "info",
        "No more songs in queue. Populating suggestion queue.",
        this.constructor.name,
      );
      await SpotifyService.populateSuggestionQueue();
      ({ trackId, userSubmittedId, requestId } =
        await QueueService.popNextTrack());
    }
    log(
      "info",
      `Next song in queue: ${trackId} ${userSubmittedId} ${requestId}`,
      this.constructor.name,
    );

    this._setStateDownloading(trackId);

    try {
      const trackMetadata = await this.getTrackData(trackId);
      trackMetadata.userSubmittedId = userSubmittedId;
      trackMetadata.requestId = requestId;

      const concatenatedAudioPath = await this._gatherSongFiles(trackMetadata);
      QueueService.addToAudioQueue({
        path: concatenatedAudioPath,
        metadata: trackMetadata,
      });
    } catch (error) {
      if (error instanceof EndableError) {
        // something real bad happened, it will happen again. end the program
        throw error;
      }
      log(
        "error",
        `Error getting next song: ${error.message}`,
        this.constructor.name,
      );
      log("warn", `Skipping song: ${trackId}`, this.constructor.name);
      await QueueService.markSongAsFailed(trackId, requestId);
    }

    this._setStateNotDownloading();
  }

  _setStateDownloading(trackId) {
    this.songDownloading = true;
    this.songDownloadingTrackId = trackId;
    EventService.emit("downloading");
  }

  _setStateNotDownloading() {
    this.songDownloading = false;
    this.songDownloadingTrackId = null;
    EventService.emit("notDownloading");
  }

  async _markSongAsPlayed(metadata) {
    this.songPlaying = true;
    this.currentSongMetadata = metadata;
    await TrackModelService.markSongAsPlayed(
      metadata.trackId,
      metadata.requestId,
    );
    log(
      "info",
      `Playing song ${metadata.title} - ${metadata.artist} from ${metadata.userSubmittedId}`,
      this.constructor.name,
    );
    EventService.emit("songStarted", metadata);
  }

  _writeDataToClients(data) {
    ClientManager._clients.forEach((client) => client.write(data));
  }

  async _getBitrateFromAudioFile(path) {
    const ffprobeResult = await ffprobe(path, {
      path: ffprobeStatic.path,
    });
    return ffprobeResult.streams[0].bit_rate;
  }

  async _streamToClients(path) {
    const bitrate = await this._getBitrateFromAudioFile(path);
    const readable = fs.createReadStream(path);
    const throttle = new Throttle(Math.floor(bitrate / 8));

    const handleForceStop = () => {
      throttle.end();
    };
    EventService.onWithServerContext("forceStopSong", handleForceStop);

    throttle
      .on("data", (data) => {
        this._writeDataToClients(data);
      })
      .on("end", () => {
        readable.close();
        this.songPlaying = false;
        this.currentSongMetadata = {};
        EventService.removeListener("forceStopSong", handleForceStop);
        EventService.emit("songEnded");
        fs.unlinkSync(path);
      });

    readable.pipe(throttle);
  }

  async _combineAudioFiles(first, second) {
    const concatenatedAudioPath = `./audio/combined-${new Date().getTime()}.mp3`;
    const ffmpeg = promisify(exec);
    await ffmpeg(
      `ffmpeg -i "${first}" -i "${second}" -filter_complex '[0:0][1:0]concat=n=2:v=0:a=1[out]' -map '[out]' -y "${concatenatedAudioPath}"`,
    );

    // don't remove the sample tts file
    if (process.env.OPENAI_API_KEY) {
      fs.unlinkSync(first);
    }
    fs.unlinkSync(second);
    return concatenatedAudioPath;
  }

  async getTrackData(trackId) {
    // Fetch metadata from the database or Spotify API
    return (
      (await TrackModelService.getSongMetadata(trackId)) ||
      (await SpotifyService.getTrackData(trackId))
    );
  }

  async _gatherSongFiles(trackMetadata) {
    let downloadSource;
    if (process.env.DOWNLOAD_SOURCE === "appleMusic") {
      if (!trackMetadata.urlForPlatform.appleMusic) {
        throw new Error(
          "No Apple Music url for track. Skipping song.",
        );
      }
      downloadSource = trackMetadata.urlForPlatform.appleMusic;
    } else {
      if (!trackMetadata.urlForPlatform.youtube) {
        throw new Error("No youtube url for track. Skipping song.");
      }
      downloadSource = trackMetadata.urlForPlatform.youtube;
    }

    const audioFilePath = await this._downloadTrack(
      downloadSource,
    );

    let announcementAudioPath;
    // If no API key is set, use the sample tts file
    if (!process.env.OPENAI_API_KEY) {
      announcementAudioPath = "./sample-tts.mp3";
    } else {
      const announcementText = await OpenAIService.generateSongIntro(
        trackMetadata,
        QueueService.getLastQueuedSongMetadata() || this.currentSongMetadata,
      );
      announcementAudioPath =
        await OpenAIService.textToSpeech(announcementText);
    }

    if (!audioFilePath || !announcementAudioPath) {
      throw new Error(
        "Failed to download track or generate intro speech. Skipping song.",
      );
    }

    return await this._combineAudioFiles(announcementAudioPath, audioFilePath);
  }

  async _downloadTrack(url) {
    const fileName = new Date().getTime();
    const filePath = `./audio/${fileName}.m4a`;
    const command = `gamdl "${url}" \
                  --no-synced-lyrics \
                  --output-path="./audio" \
                  --template-folder-album="" \
                  --template-folder-compilation="" \
                  --template-folder-no-album="" \
                  --template-file-single-disc="${fileName}" \
                  --template-file-multi-disc="${fileName}" \
                  --template-file-no-album="${fileName}"`;
    const execAsync = promisify(exec);

    for (let failCount = 1; failCount <= 10; failCount++) {
      try {
        await ProxyService.setProxy();
        log("info", `Downloading track from: ${url}`, this.constructor.name);
        await execAsync(command, { timeout: 30000 });

        if (fs.existsSync(filePath)) {
          log("info", "Downloaded track!", this.constructor.name);
          return filePath;
        }
      } catch (error) {
        log(
          "error",
          `Error downloading track: ${error}`,
          this.constructor.name,
        );
      }

      // Failed, remove files and try again
      ProxyService.markActiveProxyBad();
      log(
        "warn",
        `Failed to download track: ${url} Retry: ${failCount}`,
        this.constructor.name,
      );
      fs.readdirSync("./audio").forEach((file) => {
        if (file.includes(fileName)) {
          fs.unlinkSync(`./audio/${file}`);
        }
      });
    }
    throw new Error(
      "Failed to download track after 10 attempts. Skipping song.",
    );
  }

  isTrackIdPlayingOrDownloading(trackId) {
    return (
      this.currentSongMetadata?.trackId === trackId ||
      this.songDownloadingTrackId === trackId
    );
  }

  skipCurrentSong() {
    EventService.emit("forceStopSong");
  }
}

export default new SongController();
