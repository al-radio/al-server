import axios from "axios";
import { log } from "../utils/logger.js";

class LastfmService {
  constructor() {
    this._baseUrl = "https://ws.audioscrobbler.com/2.0/";
    this._apiKey = process.env.LASTFM_API_KEY;

    if (!this._apiKey) {
      throw new Error("Missing LASTFM_API_KEY in environment variables");
    }
  }

  async getRecommendations(trackMetadatas) {
    const totalRecommendations = 15;
    const perTrackLimit = Math.ceil(totalRecommendations / trackMetadatas.length);
    const recommendations = new Set();

    for (const track of trackMetadatas) {
      try {
        log("info", `Getting Last.fm similar tracks for: ${track.title} by ${track.artist}`, this.constructor.name);

        const response = await axios.get(this._baseUrl, {
          params: {
            method: "track.getSimilar",
            track: track.title,
            artist: track.artist,
            api_key: this._apiKey,
            format: "json",
            limit: perTrackLimit + 1,
          },
        });

        const similarTracks = response.data.similartracks?.track ?? [];

        for (const similarTrack of similarTracks) {
          const uniqueId = `${similarTrack.artist.name} - ${similarTrack.name}`;
          if (
            recommendations.size < totalRecommendations &&
            uniqueId !== `${track.artist} - ${track.title}`
          ) {
            recommendations.add({artist: similarTrack.artist.name, title: similarTrack.name});
          }
        }

        if (recommendations.size >= totalRecommendations) break;
      } catch (error) {
        log("error", `Failed to get recommendations: ${error}`, this.constructor.name);
      }
    }

    return Array.from(recommendations);
  }
}

export default new LastfmService();
